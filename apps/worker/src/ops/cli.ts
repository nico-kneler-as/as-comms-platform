import { readFile } from "node:fs/promises";
import process from "node:process";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection
} from "@as-comms/db";
import {
  createStage1NormalizationService,
  createStage1PersistenceService
} from "@as-comms/domain";
import {
  createGmailCapturePort,
  createMailchimpCapturePort,
  createSalesforceCapturePort,
  createSimpleTextingCapturePort
} from "@as-comms/integrations";

import {
  buildSafeRuntimeConfigSummary,
  readWorkerConfig
} from "../runtime.js";
import { createStage1IngestService } from "../ingest/index.js";
import { createStage1SyncStateService } from "../orchestration/index.js";
import {
  buildStage1EnqueueRequest,
  enqueueStage1Job
} from "./enqueue.js";
import { createStage1GmailMboxImportService } from "./gmail-mbox.js";
import {
  inspectAuditEvidence,
  inspectLatestSyncState,
  inspectSourceEvidenceForProviderRecord,
  inspectStage1Contact
} from "./inspect.js";
import {
  runBackfillSalesforceCommunicationDetailsCommand
} from "./backfill-salesforce-communication-details.js";
import { reconcileIdentityQueue } from "./reconcile-identity-queue.js";
import {
  runDedupHistoricalLedgerCommand
} from "./dedup-historical-ledger.js";
import {
  runReclassifySfDirectionCommand
} from "./reclassify-sf-direction.js";
import {
  buildOperationId,
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag,
  readOptionalStringFlag,
  readRequiredFlag
} from "./helpers.js";
import { readStage1LaunchScopeGmailConfig } from "./config.js";

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for Stage 1 ops commands."
    );
  }

  return connectionString;
}

function rejectUnconfiguredProvider(providerLabel: string): Promise<never> {
  return Promise.reject(
    new Error(`${providerLabel} capture is not configured for this worker runtime.`)
  );
}

function readOptionalLimitArg(args: readonly string[]): number | undefined {
  const inlineLimit = args.find((arg) => arg.startsWith("--limit="));

  if (inlineLimit !== undefined) {
    const parsed = Number.parseInt(inlineLimit.split("=")[1] ?? "", 10);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("Flag --limit must be a positive integer.");
    }

    return parsed;
  }

  const flags = parseCliFlags(args);
  const parsed = readOptionalIntegerFlag(flags, "limit", 0);
  return parsed === 0 ? undefined : parsed;
}

function runCheckConfig(): void {
  const config = readWorkerConfig({
    ...process.env,
    WORKER_BOOT_MODE: "run"
  });

  if (config === null) {
    throw new Error("Expected a validated worker config.");
  }

  console.info(JSON.stringify(buildSafeRuntimeConfigSummary(config), null, 2));
}

async function runEnqueue(args: readonly string[]): Promise<void> {
  const job = args[0];

  if (
    job !== "gmail-historical" &&
    job !== "gmail-live" &&
    job !== "salesforce-historical" &&
    job !== "salesforce-live" &&
    job !== "replay" &&
    job !== "projection-rebuild" &&
    job !== "parity-check" &&
    job !== "cutover-checkpoint"
  ) {
    throw new Error(
      "Unknown enqueue job. Use one of: gmail-historical, gmail-live, salesforce-historical, salesforce-live, replay, projection-rebuild, parity-check, cutover-checkpoint."
    );
  }

  const flags = parseCliFlags(args.slice(1));
  const request = buildStage1EnqueueRequest(job, flags);
  const result = await enqueueStage1Job({
    connectionString: readConnectionString(process.env),
    request
  });

  console.info(JSON.stringify(result, null, 2));
}

async function runImportGmailMbox(args: readonly string[]): Promise<void> {
  const flags = parseCliFlags(args);
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(process.env)
  });

  try {
    const gmailConfig = readStage1LaunchScopeGmailConfig(process.env);
    const repositories = createStage1RepositoryBundleFromConnection(connection);
    const persistence = createStage1PersistenceService(repositories);
    const normalization = createStage1NormalizationService(persistence);
    const ingest = createStage1IngestService(normalization);
    const syncState = createStage1SyncStateService(persistence);
    const importer = createStage1GmailMboxImportService({
      ingest,
      persistence,
      syncState
    });
    const mboxPath = readRequiredFlag(flags, "mbox-path");
    const mboxText = await readFile(mboxPath, "utf8");
    const result = await importer.importMbox({
      mboxText,
      mboxPath,
      capturedMailbox: readRequiredFlag(flags, "captured-mailbox"),
      projectInboxAliasOverride: readOptionalStringFlag(
        flags,
        "project-inbox-alias"
      ),
      liveAccount: gmailConfig.liveAccount,
      projectInboxAliases: [...gmailConfig.projectInboxAliases],
      syncStateId:
        readOptionalStringFlag(flags, "sync-state-id") ??
        buildOperationId("stage1:gmail:mbox:sync-state"),
      correlationId:
        readOptionalStringFlag(flags, "correlation-id") ??
        buildOperationId("stage1:gmail:mbox:correlation"),
      traceId: readOptionalStringFlag(flags, "trace-id"),
      receivedAt: readOptionalStringFlag(flags, "received-at"),
      limit: readOptionalIntegerFlag(flags, "limit", 0) || null,
      overwriteBodies: readOptionalBooleanFlag(flags, "overwrite-bodies", false)
    });

    console.info(JSON.stringify(result, null, 2));
  } finally {
    await closeDatabaseConnection(connection);
  }
}

async function runInspect(args: readonly string[]): Promise<void> {
  const subcommand = args[0];
  const flags = parseCliFlags(args.slice(1));
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(process.env)
  });

  try {
    const repositories = createStage1RepositoryBundleFromConnection(connection);

    switch (subcommand) {
      case "contact": {
        const contactId = readOptionalStringFlag(flags, "contact-id");
        const salesforceContactId = readOptionalStringFlag(
          flags,
          "salesforce-contact-id"
        );
        const email = readOptionalStringFlag(flags, "email");
        const result = await inspectStage1Contact(repositories, {
          ...(contactId === null ? {} : { contactId }),
          ...(salesforceContactId === null ? {} : { salesforceContactId }),
          ...(email === null ? {} : { email })
        });

        console.info(JSON.stringify(result, null, 2));
        return;
      }
      case "source-evidence": {
        const result = await inspectSourceEvidenceForProviderRecord(repositories, {
          provider: readRequiredFlag(flags, "provider") as
            | "gmail"
            | "salesforce"
            | "simpletexting"
            | "mailchimp",
          providerRecordType: readRequiredFlag(flags, "provider-record-type"),
          providerRecordId: readRequiredFlag(flags, "provider-record-id")
        });

        console.info(JSON.stringify(result, null, 2));
        return;
      }
      case "sync": {
        const syncStateId = readOptionalStringFlag(flags, "sync-state-id");
        const result =
          syncStateId !== null
            ? await inspectLatestSyncState(repositories, { syncStateId })
            : await inspectLatestSyncState(repositories, {
                scope:
                  (readOptionalStringFlag(flags, "scope") ?? "provider") as
                    | "provider"
                    | "orchestration",
                provider:
                  (readOptionalStringFlag(flags, "provider") as
                    | "gmail"
                    | "salesforce"
                    | "simpletexting"
                    | "mailchimp"
                    | null) ?? null,
                jobType: readRequiredFlag(flags, "job-type") as
                  | "historical_backfill"
                  | "live_ingest"
                  | "projection_rebuild"
                  | "parity_snapshot"
                  | "final_delta_sync"
                  | "dead_letter_reprocess"
              });

        console.info(JSON.stringify(result, null, 2));
        return;
      }
      case "audit": {
        const result = await inspectAuditEvidence(repositories, {
          entityType: readRequiredFlag(flags, "entity-type"),
          entityId: readRequiredFlag(flags, "entity-id")
        });

        console.info(JSON.stringify(result, null, 2));
        return;
      }
      default:
        throw new Error(
          "Unknown inspect command. Use one of: contact, source-evidence, sync, audit."
        );
    }
  } finally {
    await closeDatabaseConnection(connection);
  }
}

async function runReconcileIdentityQueue(args: readonly string[]): Promise<void> {
  const dryRun = !args.includes("--execute");
  const limit = readOptionalLimitArg(args);
  const config = readWorkerConfig({
    ...process.env,
    WORKER_BOOT_MODE: "run"
  });

  if (config === null) {
    throw new Error("Expected a validated worker config.");
  }

  const connection = createDatabaseConnection({
    connectionString: readConnectionString(process.env)
  });

  try {
    const repositories = createStage1RepositoryBundleFromConnection(connection);
    const report = await reconcileIdentityQueue({
      db: connection.db,
      repositories,
      capture: {
        gmail: createGmailCapturePort(config.capture.gmail),
        salesforce: createSalesforceCapturePort(config.capture.salesforce),
        simpleTexting:
          config.capture.simpleTexting === undefined
            ? {
                captureHistoricalBatch: () =>
                  rejectUnconfiguredProvider("SimpleTexting"),
                captureLiveBatch: () =>
                  rejectUnconfiguredProvider("SimpleTexting")
              }
            : createSimpleTextingCapturePort(config.capture.simpleTexting),
        mailchimp:
          config.capture.mailchimp === undefined
            ? {
                captureHistoricalBatch: () =>
                  rejectUnconfiguredProvider("Mailchimp"),
                captureTransitionBatch: () =>
                  rejectUnconfiguredProvider("Mailchimp")
              }
            : createMailchimpCapturePort(config.capture.mailchimp)
      },
      gmailHistoricalReplay: {
        liveAccount: config.launchScope.gmail.liveAccount,
        projectInboxAliases: [...config.launchScope.gmail.projectInboxAliases]
      },
      dryRun,
      ...(limit === undefined ? {} : { limit })
    });

    console.log("Final report:", report);
  } finally {
    await closeDatabaseConnection(connection);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "check-config":
      runCheckConfig();
      return;
    case "enqueue":
      await runEnqueue(rest);
      return;
    case "import-gmail-mbox":
      await runImportGmailMbox(rest);
      return;
    case "inspect":
      await runInspect(rest);
      return;
    case "backfill-salesforce-communication-details":
      await runBackfillSalesforceCommunicationDetailsCommand(rest, process.env);
      return;
    case "dedup-historical-ledger":
      await runDedupHistoricalLedgerCommand(rest, process.env);
      return;
    case "reconcile-identity-queue":
      await runReconcileIdentityQueue(rest);
      return;
    case "reclassify-sf-direction":
      await runReclassifySfDirectionCommand(rest, process.env);
      return;
    default:
      throw new Error(
        "Unknown Stage 1 ops command. Use one of: check-config, enqueue, import-gmail-mbox, inspect, backfill-salesforce-communication-details, dedup-historical-ledger, reconcile-identity-queue, reclassify-sf-direction."
      );
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Stage 1 ops command failed."
  );
  process.exitCode = 1;
});
