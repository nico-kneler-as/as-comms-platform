import type { Task } from "graphile-worker";

import type { Stage1Database } from "@as-comms/db";
import type { Stage1PersistenceService } from "@as-comms/domain";
import {
  createGmailMailboxApiClient,
  type GmailCaptureServiceConfig,
  type GmailMailboxApiClient,
} from "@as-comms/integrations";

import { readStage1LaunchScopeGmailConfig } from "../ops/config.js";
import { pollInboxReadState } from "../ops/poll-inbox-read-state.js";

export const pollInboxReadStateJobName = "poll-inbox-read-state" as const;

export interface PollInboxReadStateTaskDependencies {
  readonly db: Stage1Database;
  readonly persistence: Stage1PersistenceService;
  readonly gmailClient?: Pick<GmailMailboxApiClient, "getMessage">;
  readonly mailbox?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: Pick<Console, "log" | "error">;
  readonly readStatePoller?: typeof pollInboxReadState;
}

function readRequiredStringEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${key} is required for inbox read-state polling.`);
  }

  return value.trim();
}

function buildGmailMailboxClientFromEnv(env: NodeJS.ProcessEnv): {
  readonly mailbox: string;
  readonly gmailClient: Pick<GmailMailboxApiClient, "getMessage">;
} {
  const gmailConfig = readStage1LaunchScopeGmailConfig(env);
  const clientConfig: GmailCaptureServiceConfig = {
    bearerToken: "worker-poll-inbox-read-state",
    liveAccount: gmailConfig.liveAccount,
    projectInboxAliases: [...gmailConfig.projectInboxAliases],
    oauthClientId: readRequiredStringEnv(env, "GMAIL_GOOGLE_OAUTH_CLIENT_ID"),
    oauthClientSecret: readRequiredStringEnv(
      env,
      "GMAIL_GOOGLE_OAUTH_CLIENT_SECRET",
    ),
    oauthRefreshToken: readRequiredStringEnv(
      env,
      "GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN",
    ),
    tokenUri:
      env.GMAIL_GOOGLE_TOKEN_URI?.trim().length
        ? env.GMAIL_GOOGLE_TOKEN_URI.trim()
        : "https://oauth2.googleapis.com/token",
    timeoutMs:
      env.GMAIL_CAPTURE_TIMEOUT_MS === undefined
        ? 15_000
        : Number.parseInt(env.GMAIL_CAPTURE_TIMEOUT_MS, 10),
  };

  return {
    mailbox: gmailConfig.liveAccount,
    gmailClient: createGmailMailboxApiClient(clientConfig),
  };
}

function resolveTaskGmailDependencies(
  deps: PollInboxReadStateTaskDependencies,
): {
  readonly mailbox: string;
  readonly gmailClient: Pick<GmailMailboxApiClient, "getMessage">;
} {
  if (deps.gmailClient !== undefined || deps.mailbox !== undefined) {
    if (deps.gmailClient === undefined || deps.mailbox === undefined) {
      throw new Error(
        "poll-inbox-read-state task requires both mailbox and gmailClient when either override is provided.",
      );
    }

    return {
      mailbox: deps.mailbox,
      gmailClient: deps.gmailClient,
    };
  }

  return buildGmailMailboxClientFromEnv(deps.env ?? process.env);
}

export function createPollInboxReadStateTask(
  deps: PollInboxReadStateTaskDependencies,
): Task {
  const logger = deps.logger ?? console;
  const poller = deps.readStatePoller ?? pollInboxReadState;
  const gmail = resolveTaskGmailDependencies(deps);

  return async () => {
    try {
      const report = await poller({
        db: deps.db,
        persistence: deps.persistence,
        mailbox: gmail.mailbox,
        gmailClient: gmail.gmailClient,
      });

      logger.log(
        JSON.stringify({
          event: "inbox_read_state.poll.completed",
          ...report,
        }),
      );
    } catch (error) {
      logger.error(
        JSON.stringify({
          event: "inbox_read_state.poll.failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    }
  };
}
