import {
  integrationHealthSchema,
  pollPostmarkSenderStatusPayloadSchema,
  type IntegrationHealthRecord,
} from "@as-comms/contracts";
import type { IntegrationHealthRepository, Stage2RepositoryBundle } from "@as-comms/domain";
import { createPostmarkClient, type PostmarkClient } from "@as-comms/integrations";

const postmarkServiceId = "postmark";

export interface PollPostmarkSenderStatusConfig {
  readonly serverToken: string | null;
  readonly accountToken: string | null;
  readonly baseUrl: string;
}

export interface PollPostmarkSenderStatusDependencies {
  readonly projects: Stage2RepositoryBundle["projects"];
  readonly integrationHealth: IntegrationHealthRepository;
  readonly config: PollPostmarkSenderStatusConfig;
  readonly createClient?: (input: {
    readonly serverToken: string;
    readonly accountToken: string;
    readonly baseUrl: string;
  }) => PostmarkClient;
  readonly logger?: Pick<Console, "error" | "info" | "warn">;
  readonly now?: () => Date;
}

function readOptionalEnv(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

export function readPollPostmarkSenderStatusConfig(
  env: NodeJS.ProcessEnv,
): PollPostmarkSenderStatusConfig {
  return {
    serverToken: readOptionalEnv(env.POSTMARK_SERVER_TOKEN),
    accountToken: readOptionalEnv(env.POSTMARK_ACCOUNT_TOKEN),
    baseUrl: env.POSTMARK_BASE_URL?.trim() ?? "https://api.postmarkapp.com",
  };
}

function buildHealthRecord(
  previous: IntegrationHealthRecord | null,
  input: {
    readonly status: IntegrationHealthRecord["status"];
    readonly detail: string | null;
    readonly checkedAt: string;
    readonly metadataJson?: Record<string, unknown>;
  },
): IntegrationHealthRecord {
  return integrationHealthSchema.parse({
    id: postmarkServiceId,
    serviceName: postmarkServiceId,
    category: "messaging",
    status: input.status,
    lastCheckedAt: input.checkedAt,
    degradedSinceAt:
      input.status === "healthy"
        ? null
        : previous?.degradedSinceAt ?? input.checkedAt,
    lastAlertSentAt:
      input.status === "healthy" ? null : previous?.lastAlertSentAt ?? null,
    detail: input.detail,
    metadataJson: input.metadataJson ?? previous?.metadataJson ?? {},
    createdAt: previous?.createdAt ?? input.checkedAt,
    updatedAt: input.checkedAt,
  });
}

function extractEmailDomain(email: string | null): string | null {
  if (email === null) {
    return null;
  }

  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) {
    return null;
  }

  return email.slice(at + 1).toLowerCase();
}

export async function runPollPostmarkSenderStatus(
  dependencies: PollPostmarkSenderStatusDependencies,
  rawPayload: unknown,
): Promise<void> {
  const payload = pollPostmarkSenderStatusPayloadSchema.parse(rawPayload);
  const logger = dependencies.logger ?? console;
  const now = dependencies.now?.() ?? new Date();
  const checkedAt = now.toISOString();

  await dependencies.integrationHealth.seedDefaults();
  const existingHealth =
    await dependencies.integrationHealth.findById(postmarkServiceId);

  if (
    dependencies.config.serverToken === null ||
    dependencies.config.accountToken === null
  ) {
    await dependencies.integrationHealth.upsert(
      buildHealthRecord(existingHealth, {
        status: "not_configured",
        detail:
          "POSTMARK_SERVER_TOKEN and POSTMARK_ACCOUNT_TOKEN must both be configured.",
        checkedAt,
      }),
    );
    return;
  }

  const client = (dependencies.createClient ?? ((input) =>
    createPostmarkClient({
      serverToken: input.serverToken,
      accountToken: input.accountToken,
      webhookSigningSecret: "unused",
      baseUrl: input.baseUrl,
    })))({
    serverToken: dependencies.config.serverToken,
    accountToken: dependencies.config.accountToken,
    baseUrl: dependencies.config.baseUrl,
  });

  const projects = await dependencies.projects.listAll();
  const scopedProjects =
    payload.projectId === undefined
      ? projects
      : projects.filter((project) => project.projectId === payload.projectId);
  const domains = new Map<string, string[]>();

  for (const project of scopedProjects) {
    for (const email of project.emails) {
      const domain = extractEmailDomain(email.address);
      if (domain === null) {
        continue;
      }

      const projectIds = domains.get(domain) ?? [];
      projectIds.push(project.projectId);
      domains.set(domain, projectIds);
    }
  }

  try {
    const statuses: {
      domain: string;
      status: string;
      projectIds: readonly string[];
    }[] = [];

    for (const [domain, projectIds] of domains) {
      const sender = await client.getSenderDomainStatus(domain);
      const uniqueProjectIds = [...new Set(projectIds)];
      statuses.push({
        domain,
        status: sender.status,
        projectIds: uniqueProjectIds,
      });

      for (const projectId of uniqueProjectIds) {
        await dependencies.projects.setPostmarkSenderStatus(
          projectId,
          sender.status,
        );
      }
    }

    await dependencies.integrationHealth.upsert(
      buildHealthRecord(existingHealth, {
        status: "healthy",
        detail:
          statuses.length === 0
            ? "No project alias domains were eligible for Postmark sender checks."
            : null,
        checkedAt,
        metadataJson: {
          trigger: payload.trigger,
          statuses,
        },
      }),
    );

    logger.info(
      JSON.stringify({
        event: "postmark.sender_status_poll.completed",
        trigger: payload.trigger,
        checkedAt,
        domainCount: statuses.length,
      }),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    await dependencies.integrationHealth.upsert(
      buildHealthRecord(existingHealth, {
        status: "needs_attention",
        detail,
        checkedAt,
      }),
    );

    logger.error(
      JSON.stringify({
        event: "postmark.sender_status_poll.failed",
        trigger: payload.trigger,
        checkedAt,
        detail,
      }),
    );

    throw error;
  }
}
