#!/usr/bin/env tsx
/**
 * re-extract-signed-envelope-bodies
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops:re-extract-signed-envelope-bodies
 *   pnpm --filter @as-comms/worker ops:re-extract-signed-envelope-bodies --execute
 *
 * Re-fetches Gmail messages whose body_text_preview is currently the (~200 char)
 * snippet because mailparser previously failed on a multipart/signed envelope.
 * Runs the new direct-decode path against the fresh payload and, when it
 * yields a longer plaintext body, writes that body back to gmail_message_details.
 *
 * Candidate criterion: body_text_preview equals snippet_clean AND from_header
 * matches a known signing-domain sender (proton.me, protonmail.com,
 * mountainmadness.com). Override with --source-evidence-ids id1,id2,...
 */
import { realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { eq, inArray } from "drizzle-orm";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  gmailMessageDetails,
  type Stage1Database,
} from "@as-comms/db";
import {
  createGmailMailboxApiClient,
  extractGmailBodyPreviewFromPayloadResult,
  type GmailCaptureServiceConfig,
  type GmailMailboxApiClient,
} from "@as-comms/integrations";

import { readStage1LaunchScopeGmailConfig } from "./config.js";
import { parseCliFlags } from "./helpers.js";

const SIGNING_DOMAIN_PATTERNS: readonly RegExp[] = [
  /@proton\.me\b/iu,
  /@protonmail\.com\b/iu,
  /@mountainmadness\.com\b/iu,
];

interface CandidateRow {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly capturedMailbox: string | null;
  readonly fromHeader: string | null;
  readonly bodyTextPreview: string;
  readonly snippetClean: string;
}

interface ReExtractResult {
  readonly dryRun: boolean;
  readonly scanned: number;
  readonly fetched: number;
  readonly upgraded: number;
  readonly unchanged: number;
  readonly failed: number;
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const value = env.DATABASE_URL;

  if (value === undefined || value.trim().length === 0) {
    throw new Error("DATABASE_URL is required.");
  }

  return value.trim();
}

function readRequiredStringEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${key} is required for re-extracting signed bodies.`);
  }

  return value.trim();
}

function buildGmailApiClient(env: NodeJS.ProcessEnv): GmailMailboxApiClient {
  const gmailConfig = readStage1LaunchScopeGmailConfig(env);
  const clientConfig: GmailCaptureServiceConfig = {
    bearerToken: "ops-re-extract-signed",
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

  return createGmailMailboxApiClient(clientConfig);
}

function isSigningDomainSender(fromHeader: string | null): boolean {
  if (fromHeader === null) {
    return false;
  }

  return SIGNING_DOMAIN_PATTERNS.some((pattern) => pattern.test(fromHeader));
}

async function loadCandidates(
  db: Stage1Database,
  explicitIds: readonly string[] | null,
): Promise<readonly CandidateRow[]> {
  const rows = await db
    .select({
      sourceEvidenceId: gmailMessageDetails.sourceEvidenceId,
      providerRecordId: gmailMessageDetails.providerRecordId,
      capturedMailbox: gmailMessageDetails.capturedMailbox,
      fromHeader: gmailMessageDetails.fromHeader,
      bodyTextPreview: gmailMessageDetails.bodyTextPreview,
      snippetClean: gmailMessageDetails.snippetClean,
    })
    .from(gmailMessageDetails)
    .where(
      explicitIds !== null && explicitIds.length > 0
        ? inArray(gmailMessageDetails.sourceEvidenceId, [...explicitIds])
        : undefined,
    );

  if (explicitIds !== null && explicitIds.length > 0) {
    return rows;
  }

  return rows.filter(
    (row) =>
      row.bodyTextPreview === row.snippetClean &&
      row.bodyTextPreview.length > 0 &&
      isSigningDomainSender(row.fromHeader),
  );
}

async function reExtractSignedEnvelopeBodies(input: {
  readonly db: Stage1Database;
  readonly apiClient: GmailMailboxApiClient;
  readonly dryRun: boolean;
  readonly explicitIds: readonly string[] | null;
}): Promise<ReExtractResult> {
  const candidates = await loadCandidates(input.db, input.explicitIds);
  let fetched = 0;
  let upgraded = 0;
  let unchanged = 0;
  let failed = 0;

  for (const candidate of candidates) {
    if (
      candidate.capturedMailbox === null ||
      candidate.capturedMailbox.length === 0
    ) {
      console.info(
        JSON.stringify({
          source_evidence_id: candidate.sourceEvidenceId,
          status: "skipped_no_mailbox",
        }),
      );
      failed += 1;
      continue;
    }

    let message: Awaited<ReturnType<GmailMailboxApiClient["getMessage"]>>;
    try {
      message = await input.apiClient.getMessage({
        mailbox: candidate.capturedMailbox,
        messageId: candidate.providerRecordId,
      });
      fetched += 1;
    } catch (error) {
      console.info(
        JSON.stringify({
          source_evidence_id: candidate.sourceEvidenceId,
          status: "fetch_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      failed += 1;
      continue;
    }

    if (message === null) {
      console.info(
        JSON.stringify({
          source_evidence_id: candidate.sourceEvidenceId,
          status: "message_not_found",
        }),
      );
      failed += 1;
      continue;
    }

    const result = await extractGmailBodyPreviewFromPayloadResult(
      message.payload,
      { messageIdentifier: message.id },
    );

    if (
      result.bodyKind !== "plaintext" ||
      result.bodyTextPreview.length <= candidate.bodyTextPreview.length
    ) {
      console.info(
        JSON.stringify({
          source_evidence_id: candidate.sourceEvidenceId,
          status: "no_upgrade",
          new_kind: result.bodyKind,
          new_len: result.bodyTextPreview.length,
          old_len: candidate.bodyTextPreview.length,
        }),
      );
      unchanged += 1;
      continue;
    }

    console.info(
      JSON.stringify({
        source_evidence_id: candidate.sourceEvidenceId,
        status: input.dryRun ? "would_upgrade" : "upgraded",
        old_len: candidate.bodyTextPreview.length,
        new_len: result.bodyTextPreview.length,
        new_sample: result.bodyTextPreview.slice(0, 120),
      }),
    );

    if (!input.dryRun) {
      await input.db
        .update(gmailMessageDetails)
        .set({
          bodyTextPreview: result.bodyTextPreview,
          bodyKind: result.bodyKind,
          updatedAt: new Date(),
        })
        .where(
          eq(
            gmailMessageDetails.sourceEvidenceId,
            candidate.sourceEvidenceId,
          ),
        );
    }

    upgraded += 1;
  }

  return {
    dryRun: input.dryRun,
    scanned: candidates.length,
    fetched,
    upgraded,
    unchanged,
    failed,
  };
}

export async function runReExtractSignedEnvelopeBodiesCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const flags = parseCliFlags(args);
  const execute = Boolean(flags.execute);
  const explicitIdsRaw = flags["source-evidence-ids"];
  const explicitIds =
    typeof explicitIdsRaw === "string" && explicitIdsRaw.length > 0
      ? explicitIdsRaw.split(",").map((id) => id.trim()).filter((id) => id.length > 0)
      : null;

  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    const apiClient = buildGmailApiClient(env);
    const result = await reExtractSignedEnvelopeBodies({
      db: connection.db,
      apiClient,
      dryRun: !execute,
      explicitIds,
    });

    console.info(JSON.stringify(result, null, 2));
  } finally {
    await closeDatabaseConnection(connection);
  }
}

const entrypoint = realpathSync(process.argv[1] ?? "");

if (entrypoint === fileURLToPath(import.meta.url)) {
  void runReExtractSignedEnvelopeBodiesCommand(process.argv.slice(2), process.env);
}
