import { run, type Runner, type TaskList } from "graphile-worker";
import { z } from "zod";

import {
  closeDatabaseConnection,
  createMailchimpCampaignTailStateRepository,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  createStage5RepositoryBundleFromConnection,
  createStage2RepositoryBundleFromConnection,
  type DatabaseConnection,
} from "@as-comms/db";
import {
  createAudienceResolver,
  createCampaignSendOrchestrator,
  createExclusionFilter,
  createMergeRenderer,
  createStage1NormalizationService,
  createStage1PersistenceService,
} from "@as-comms/domain";
import {
  capturePortHttpConfigSchema,
  createAnthropicClient,
  createGmailCapturePort,
  createMailchimpCapturePort,
  createPostmarkClient,
  InlineTextFetcher,
  invokeModel,
  NotionPageFetcher,
  createSalesforceCapturePort,
  createSimpleTextingCapturePort,
  ProviderCaptureConfigError,
  type FetchImplementation,
  WebPageFetcher,
} from "@as-comms/integrations";

import { createStage1IngestService } from "./ingest/index.js";
import {
  Stage1WorkerConfigError,
  readProjectInboxAliasesFromDb,
  readStage1LaunchScopeConfig,
  stage1LaunchScopeConfigSchema,
  type Stage1SafeRuntimeConfigSummary,
} from "./ops/config.js";
import { readNotionKnowledgeSyncConfig } from "./jobs/notion-knowledge-sync/index.js";
import { type CampaignSendTaskDependencies } from "./jobs/campaign-send/index.js";
import { readPollPostmarkSenderStatusConfig } from "./jobs/poll-postmark-sender-status/index.js";
import { dedupHistoricalLedgerJobName } from "./jobs/dedup-historical-ledger.js";
import { reconcileCaptureGapsJobName } from "./jobs/reconcile-capture-gaps.js";
import { reconcileRoutingReviewQueueJobName } from "./jobs/reconcile-routing-review-queue.js";
import { type SynthesizeProjectKnowledgeDependencies } from "./jobs/synthesize-project-knowledge/index.js";
import {
  createStage1SyncStateService,
  createStage1WorkerOrchestrationService,
  mailchimpTransitionSchedulerJobName,
  type MailchimpCapturePort,
  pollAiKnowledgeAutoSyncJobName,
  pollGmailLiveJobName,
  pollIntegrationHealthJobName,
  pollSalesforceLiveJobName,
  type SimpleTextingCapturePort,
  type Stage1WorkerOrchestrationService,
} from "./orchestration/index.js";
import { createTaskList } from "./tasks.js";
import { reconcileIdentityQueueJobName } from "./jobs/reconcile-identity-queue.js";
import { reconcileStaleRunningJobName } from "./jobs/reconcile-stale-running.js";
import { sweepPendingOutboundsJobName } from "./jobs/sweep-pending-outbounds.js";
import { pollPostmarkSenderStatusJobName } from "./jobs/poll-postmark-sender-status/index.js";

const defaultSyncStateLeaseThresholdMs = 5 * 60 * 1000;
const mailchimpTransitionDiscoverySeedLookbackDays = 35;
const defaultSynthesisRootPageId = "3278a912921180598688fce711ab0509";

function parseBooleanEnv(value: unknown): boolean {
  // Pass booleans through unchanged. The schema this preprocess feeds is
  // composed inside an outer schema (workerConfigSchema), so when the outer
  // schema re-parses an already-parsed inner value, the preprocess fires a
  // second time on a boolean — which would otherwise fall through to the
  // non-string branch and incorrectly return false. Observed 2026-05-04 in
  // production after MAILCHIMP_TRANSITION_ENABLED=true was set.
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

const workerCaptureConfigSchema = z.object({
  gmail: capturePortHttpConfigSchema,
  salesforce: capturePortHttpConfigSchema,
  simpleTexting: capturePortHttpConfigSchema.optional(),
  mailchimp: capturePortHttpConfigSchema.optional(),
});

const workerMailchimpTransitionConfigSchema = z.object({
  enabled: z.preprocess(parseBooleanEnv, z.boolean()).default(false),
  discoverySeed: z.string().datetime(),
});

const workerWebConfigSchema = z.object({
  revalidateBaseUrl: z.string().url(),
  revalidateToken: z.string().min(1),
});

const workerConfigSchema = z.object({
  connectionString: z.string().min(1),
  concurrency: z.number().int().positive().default(1),
  launchScope: stage1LaunchScopeConfigSchema,
  capture: workerCaptureConfigSchema,
  mailchimpTransition: workerMailchimpTransitionConfigSchema,
  web: workerWebConfigSchema.optional(),
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export interface Stage1WorkerRuntimeServices {
  readonly connection: DatabaseConnection;
  readonly orchestration: Stage1WorkerOrchestrationService;
  readonly taskList: TaskList;
  dispose(): Promise<void>;
}

function toCronMinuteInterval(providerLabel: string, seconds: number): number {
  if (seconds % 60 !== 0) {
    throw new Stage1WorkerConfigError(
      `${providerLabel} poll interval must be a whole-number multiple of 60 seconds for Graphile Worker crontab scheduling.`,
    );
  }

  return seconds / 60;
}

export function buildWorkerCrontab(config: WorkerConfig): string {
  const gmailMinutes = toCronMinuteInterval(
    "Gmail live",
    config.launchScope.gmail.livePollIntervalSeconds,
  );
  const salesforceMinutes = toCronMinuteInterval(
    "Salesforce Task",
    config.launchScope.salesforce.taskPollIntervalSeconds,
  );

  return [
    `*/${String(gmailMinutes)} * * * * ${pollGmailLiveJobName} ?id=gmail-live-poll&max=1`,
    `*/${String(salesforceMinutes)} * * * * ${pollSalesforceLiveJobName} ?id=salesforce-live-poll&max=1`,
    `0 * * * * ${mailchimpTransitionSchedulerJobName} ?id=mailchimp-transition-scheduler&max=1`,
    `0 * * * * ${pollAiKnowledgeAutoSyncJobName} ?id=ai-knowledge-auto-sync-poll&max=1`,
    `*/5 * * * * ${pollIntegrationHealthJobName} ?id=integration-health-poll&max=1`,
    `*/5 * * * * ${pollPostmarkSenderStatusJobName} ?id=postmark-sender-status-poll&max=1`,
    `*/5 * * * * ${sweepPendingOutboundsJobName} ?id=composer-orphan-sweep&max=1`,
    `* * * * * ${reconcileStaleRunningJobName} ?id=stale-running-sweep&max=1`,
    `*/15 * * * * ${reconcileIdentityQueueJobName} ?id=identity-queue-reconcile&max=1`,
    `0 10 * * * ${dedupHistoricalLedgerJobName} ?id=dedup-historical-ledger&max=1`,
    `30 10 * * * ${reconcileCaptureGapsJobName} ?id=capture-gap-reconcile&max=1`,
    `*/15 * * * * ${reconcileRoutingReviewQueueJobName} ?id=routing-review-queue-reconcile&max=1`,
  ].join("\n");
}

function readSyncStateLeaseThresholdMs(env: NodeJS.ProcessEnv): number {
  const parsed = Number(
    env.SYNC_STATE_LEASE_THRESHOLD_MS ??
      String(defaultSyncStateLeaseThresholdMs)
  );

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultSyncStateLeaseThresholdMs;
  }

  return parsed;
}

function buildDefaultMailchimpTransitionDiscoverySeed(now = new Date()): string {
  return new Date(
    now.getTime() -
      mailchimpTransitionDiscoverySeedLookbackDays * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function readOptionalTrimmedEnv(
  value: string | undefined,
): string | null {
  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function buildCampaignSendDependencies(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly campaigns: ReturnType<typeof createStage5RepositoryBundleFromConnection>;
  readonly repositories: ReturnType<typeof createStage1RepositoryBundleFromConnection>;
  readonly settings: ReturnType<typeof createStage2RepositoryBundleFromConnection>;
}): CampaignSendTaskDependencies | undefined {
  const serverToken = readOptionalTrimmedEnv(input.env.POSTMARK_SERVER_TOKEN);
  const baseUrl =
    readOptionalTrimmedEnv(input.env.POSTMARK_BASE_URL) ??
    "https://api.postmarkapp.com";

  if (serverToken === null) {
    console.warn(
      "Skipping campaign-send wiring because POSTMARK_SERVER_TOKEN is missing.",
    );
    return undefined;
  }

  const audienceResolver = createAudienceResolver({
    repositories: {
      contacts: input.repositories.contacts,
      contactMemberships: input.repositories.contactMemberships,
      canonicalEvents: input.repositories.canonicalEvents,
      projectDimensions: input.repositories.projectDimensions,
      settingsProjects: input.settings.projects,
    },
  });
  const exclusionFilter = createExclusionFilter({
    repositories: {
      campaignRuns: input.campaigns.campaignRuns,
      contactConsent: input.campaigns.contactConsent,
      suppressionList: input.campaigns.suppressionList,
    },
  });
  const mergeRenderer = createMergeRenderer();
  const postmarkClient = createPostmarkClient({
    serverToken,
    accountToken: readOptionalTrimmedEnv(input.env.POSTMARK_ACCOUNT_TOKEN),
    webhookSigningSecret:
      readOptionalTrimmedEnv(input.env.POSTMARK_WEBHOOK_SIGNING_SECRET) ??
      "unused",
    baseUrl,
  });

  return {
    orchestrator: createCampaignSendOrchestrator({
      repositories: {
        campaignRuns: input.campaigns.campaignRuns,
        audienceSnapshots: input.campaigns.audienceSnapshots,
        settingsProjects: input.settings.projects,
      },
      audienceResolver,
      exclusionFilter,
      mergeRenderer,
      postmarkClient,
    }),
  };
}

function buildSynthesizeProjectKnowledgeDependencies(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly fetchImplementation: FetchImplementation;
  readonly repositories: ReturnType<typeof createStage1RepositoryBundleFromConnection>;
  readonly settings: ReturnType<typeof createStage2RepositoryBundleFromConnection>;
}): SynthesizeProjectKnowledgeDependencies | undefined {
  const notionApiKey = readOptionalTrimmedEnv(input.env.NOTION_API_KEY);
  const anthropicApiKey = readOptionalTrimmedEnv(input.env.ANTHROPIC_API_KEY);

  if (notionApiKey === null || anthropicApiKey === null) {
    console.warn(
      "Skipping synthesize-project-knowledge wiring because NOTION_API_KEY or ANTHROPIC_API_KEY is missing.",
    );
    return undefined;
  }

  const anthropicClient = createAnthropicClient({
    ANTHROPIC_API_KEY: anthropicApiKey,
  });
  const model =
    readOptionalTrimmedEnv(input.env.ANTHROPIC_MODEL) ?? "claude-sonnet-4-6";

  return {
    repositories: {
      projectDimensions: input.repositories.projectDimensions,
      projectKnowledge: input.repositories.projectKnowledge,
      settingsProjects: input.settings.projects,
    },
    fetchers: {
      notion: new NotionPageFetcher({ apiKey: notionApiKey }),
      web_page: new WebPageFetcher({
        fetchImplementation: input.fetchImplementation,
      }),
      inline_text: new InlineTextFetcher(),
    },
    notion: {
      apiKey: notionApiKey,
      rootPageId:
        readOptionalTrimmedEnv(input.env.AI_ASSISTANT_TRAINING_ROOT_PAGE_ID) ??
        defaultSynthesisRootPageId,
    },
    model,
    invokeModel: (payload) => invokeModel(anthropicClient, payload),
  };
}

function readMailchimpTransitionConfig(
  env: NodeJS.ProcessEnv,
  now = new Date(),
): z.infer<typeof workerMailchimpTransitionConfigSchema> {
  const rawEnabled = env.MAILCHIMP_TRANSITION_ENABLED;
  const preProcessOutput = parseBooleanEnv(rawEnabled);
  const parsed = workerMailchimpTransitionConfigSchema.parse({
    enabled: rawEnabled,
    discoverySeed:
      env.MAILCHIMP_TRANSITION_DISCOVERY_SEED ??
      buildDefaultMailchimpTransitionDiscoverySeed(now),
  });
  console.info(
    `[mailchimp.config.diag] rawEnabled=${JSON.stringify(rawEnabled ?? null)} parseBooleanEnv=${String(preProcessOutput)} parsed.enabled=${String(parsed.enabled)}`,
  );
  return parsed;
}

function readOptionalCaptureConfig(
  env: NodeJS.ProcessEnv,
  input: {
    readonly baseUrlKey: string;
    readonly tokenKey: string;
    readonly timeoutMsKey?: string;
    readonly defaultTimeoutMs?: number;
  },
):
  | { readonly baseUrl?: string; readonly bearerToken?: string; readonly timeoutMs?: number }
  | undefined {
  const baseUrl = env[input.baseUrlKey];
  const bearerToken = env[input.tokenKey];

  if (baseUrl === undefined && bearerToken === undefined) {
    return undefined;
  }

  const timeoutFromEnv =
    input.timeoutMsKey === undefined
      ? undefined
      : Number.parseInt(env[input.timeoutMsKey] ?? "", 10);
  const timeoutMs =
    timeoutFromEnv !== undefined && Number.isFinite(timeoutFromEnv)
      ? timeoutFromEnv
      : input.defaultTimeoutMs;

  return {
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(bearerToken === undefined ? {} : { bearerToken }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

function buildDeferredLaunchScopeMessage(providerLabel: string): string {
  return `${providerLabel} capture is deferred for the narrowed Gmail + Salesforce Stage 1 launch scope. Configure this capture port only when resuming non-launch providers.`;
}

function readOptionalWebConfig(env: NodeJS.ProcessEnv):
  | {
      readonly revalidateBaseUrl?: string;
      readonly revalidateToken?: string;
    }
  | undefined {
  const revalidateBaseUrl = env.INBOX_REVALIDATE_BASE_URL;
  const revalidateToken = env.INBOX_REVALIDATE_TOKEN;

  if (revalidateBaseUrl === undefined && revalidateToken === undefined) {
    return undefined;
  }

  return {
    ...(revalidateBaseUrl === undefined ? {} : { revalidateBaseUrl }),
    ...(revalidateToken === undefined ? {} : { revalidateToken }),
  };
}

function rejectDeferredLaunchScopeProvider(
  providerLabel: string,
): Promise<never> {
  return Promise.reject(
    new ProviderCaptureConfigError(
      buildDeferredLaunchScopeMessage(providerLabel),
    ),
  );
}

function createDeferredSimpleTextingCapturePort(): SimpleTextingCapturePort {
  return {
    captureHistoricalBatch: () =>
      rejectDeferredLaunchScopeProvider("SimpleTexting"),
    captureLiveBatch: () => rejectDeferredLaunchScopeProvider("SimpleTexting"),
  };
}

function createDeferredMailchimpCapturePort(): MailchimpCapturePort {
  return {
    captureHistoricalBatch: () =>
      rejectDeferredLaunchScopeProvider("Mailchimp"),
    captureTransitionBatch: () =>
      rejectDeferredLaunchScopeProvider("Mailchimp"),
  };
}

export function readWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig | null {
  if (env.WORKER_BOOT_MODE !== "run") {
    return null;
  }

  return workerConfigSchema.parse({
    connectionString: env.WORKER_DATABASE_URL ?? env.DATABASE_URL,
    concurrency:
      env.WORKER_CONCURRENCY === undefined
        ? 1
        : Number.parseInt(env.WORKER_CONCURRENCY, 10),
    launchScope: readStage1LaunchScopeConfig(env),
    capture: {
      gmail: {
        baseUrl: env.GMAIL_CAPTURE_BASE_URL,
        bearerToken: env.GMAIL_CAPTURE_TOKEN,
      },
      salesforce: {
        baseUrl: env.SALESFORCE_CAPTURE_BASE_URL,
        bearerToken: env.SALESFORCE_CAPTURE_TOKEN,
      },
      simpleTexting: readOptionalCaptureConfig(env, {
        baseUrlKey: "SIMPLETEXTING_CAPTURE_BASE_URL",
        tokenKey: "SIMPLETEXTING_CAPTURE_TOKEN",
      }),
      mailchimp: readOptionalCaptureConfig(env, {
        baseUrlKey: "MAILCHIMP_CAPTURE_BASE_URL",
        tokenKey: "MAILCHIMP_CAPTURE_TOKEN",
        timeoutMsKey: "MAILCHIMP_CAPTURE_TIMEOUT_MS",
        // Mailchimp's Marketing API can be slow on /reports/email-activity
        // for large campaigns. Observed 2026-05-04: P95 17s+ for legitimate
        // responses. Default 60s; override via MAILCHIMP_CAPTURE_TIMEOUT_MS.
        defaultTimeoutMs: 60_000,
      }),
    },
    mailchimpTransition: readMailchimpTransitionConfig(env),
    web: readOptionalWebConfig(env),
  });
}

export function buildSafeRuntimeConfigSummary(
  config: WorkerConfig,
): Stage1SafeRuntimeConfigSummary {
  return {
    concurrency: config.concurrency,
    gmail: {
      historicalBackfillMode: config.launchScope.gmail.historicalBackfillMode,
      liveAccount: config.launchScope.gmail.liveAccount,
      projectInboxAliases: config.launchScope.gmail.projectInboxAliases,
      livePollIntervalSeconds: config.launchScope.gmail.livePollIntervalSeconds,
      captureBaseUrl: config.capture.gmail.baseUrl,
    },
    salesforce: {
      contactCaptureMode: config.launchScope.salesforce.contactCaptureMode,
      membershipCaptureMode:
        config.launchScope.salesforce.membershipCaptureMode,
      taskPollIntervalSeconds:
        config.launchScope.salesforce.taskPollIntervalSeconds,
      captureBaseUrl: config.capture.salesforce.baseUrl,
    },
    deferredProviders: {
      simpleTextingConfigured: config.capture.simpleTexting !== undefined,
      mailchimpConfigured: config.capture.mailchimp !== undefined,
    },
  };
}

export async function createStage1WorkerRuntimeServices(
  config: WorkerConfig,
  input?: {
    readonly fetchImplementation?: FetchImplementation;
    readonly env?: NodeJS.ProcessEnv;
  },
): Promise<Stage1WorkerRuntimeServices> {
  const connection = createDatabaseConnection({
    connectionString: config.connectionString,
  });

  // Prefer aliases from the DB; fall back to the env-var-derived config if the
  // project_aliases table is empty (bootstrap path — env var remains required).
  const dbAliases = await readProjectInboxAliasesFromDb(connection);
  const projectInboxAliases =
    dbAliases !== null && dbAliases.length > 0
      ? dbAliases
      : [...config.launchScope.gmail.projectInboxAliases];

  const repositories = createStage1RepositoryBundleFromConnection(connection);
  const campaigns = createStage5RepositoryBundleFromConnection(connection);
  const mailchimpTailState = createMailchimpCampaignTailStateRepository(
    connection.db,
  );
  const settings = createStage2RepositoryBundleFromConnection(connection);
  const notionKnowledgeSync = readNotionKnowledgeSyncConfig(
    input?.env ?? process.env,
  );
  const postmarkSenderStatus = readPollPostmarkSenderStatusConfig(
    input?.env ?? process.env,
  );
  const campaignSend = buildCampaignSendDependencies({
    env: input?.env ?? process.env,
    campaigns,
    repositories,
    settings,
  });
  const persistence = createStage1PersistenceService(repositories);
  const normalization = createStage1NormalizationService(persistence);
  const ingest = createStage1IngestService(normalization);
  const syncState = createStage1SyncStateService(persistence);
  const fetchOptions =
    input?.fetchImplementation === undefined
      ? undefined
      : {
          fetchImplementation: input.fetchImplementation,
        };
  const fetchImplementation = input?.fetchImplementation ?? fetch;
  const leaseThresholdMs = readSyncStateLeaseThresholdMs(input?.env ?? process.env);
  const synthesizeProjectKnowledge = buildSynthesizeProjectKnowledgeDependencies(
    {
      env: input?.env ?? process.env,
      fetchImplementation,
      repositories,
      settings,
    },
  );
  const capture = {
    gmail: createGmailCapturePort(config.capture.gmail, fetchOptions),
    salesforce: createSalesforceCapturePort(
      config.capture.salesforce,
      fetchOptions,
    ),
    simpleTexting:
      config.capture.simpleTexting === undefined
        ? createDeferredSimpleTextingCapturePort()
        : createSimpleTextingCapturePort(
            config.capture.simpleTexting,
            fetchOptions,
          ),
    mailchimp:
      config.capture.mailchimp === undefined
        ? createDeferredMailchimpCapturePort()
        : createMailchimpCapturePort(config.capture.mailchimp, fetchOptions),
  };
  const revalidateInboxViews = createWebInboxInvalidationPort(
    config.web,
    fetchImplementation,
  );
  const orchestration = createStage1WorkerOrchestrationService({
    capture,
    ingest,
    normalization,
    persistence,
    livePolling: {
      gmailPollIntervalSeconds:
        config.launchScope.gmail.livePollIntervalSeconds,
      salesforcePollIntervalSeconds:
        config.launchScope.salesforce.taskPollIntervalSeconds,
    },
    revalidateInboxViews,
    gmailHistoricalReplay: {
      liveAccount: config.launchScope.gmail.liveAccount,
      projectInboxAliases,
    },
    mailchimpTransition: {
      enabled: config.mailchimpTransition.enabled,
      discoverySeed: config.mailchimpTransition.discoverySeed,
      tailState: mailchimpTailState,
    },
  });

  return {
    connection,
    orchestration,
    taskList: createTaskList(orchestration, {
      integrationHealth: {
        integrationHealth: settings.integrationHealth,
        captureBaseUrls: {
          gmail: config.capture.gmail.baseUrl,
          salesforce: config.capture.salesforce.baseUrl,
          mailchimp: config.capture.mailchimp?.baseUrl ?? null,
        },
        fetchImplementation,
      },
      notionKnowledgeSync: {
        db: connection.db,
        integrationHealth: settings.integrationHealth,
        notion: notionKnowledgeSync,
      },
      pollPostmarkSenderStatus: {
        projects: settings.projects,
        integrationHealth: settings.integrationHealth,
        config: postmarkSenderStatus,
      },
      ...(campaignSend === undefined
        ? {}
        : {
            campaignSend,
          }),
      aiKnowledgeAutoSync: {
        projectDimensions: repositories.projectDimensions,
      },
      ...(synthesizeProjectKnowledge === undefined
        ? {}
        : {
            synthesizeProjectKnowledge,
          }),
      pendingOutboundSweep: {
        pendingOutbounds: repositories.pendingOutbounds,
      },
      dedupHistoricalLedger: {
        db: connection.db,
        repositories,
      },
      reconcileIdentityQueue: {
        db: connection.db,
        repositories,
        capture,
        gmailHistoricalReplay: {
          liveAccount: config.launchScope.gmail.liveAccount,
          projectInboxAliases,
        },
      },
      reconcileRoutingReviewQueue: {
        db: connection.db,
        repositories,
      },
      reconcileCaptureGaps: {
        db: connection.db,
        repositories,
      },
      reconcileStaleRunning: {
        db: connection.db,
        repositories,
        syncState,
        leaseThresholdMs,
      },
    }),
    dispose() {
      return closeDatabaseConnection(connection);
    },
  };
}

function createWebInboxInvalidationPort(
  config: WorkerConfig["web"],
  fetchImplementation: FetchImplementation,
): (input: { readonly contactIds: readonly string[] }) => Promise<void> {
  if (config === undefined) {
    return () => Promise.resolve();
  }

  return async (input) => {
    if (input.contactIds.length === 0) {
      return;
    }

    const response = await fetchImplementation(
      new URL("/api/internal/revalidate", config.revalidateBaseUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.revalidateToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contactIds: input.contactIds,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Inbox revalidation failed with status ${response.status.toString()}.`,
      );
    }
  };
}

export async function startWorker(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Runner | null> {
  const config = readWorkerConfig(env);

  if (!config) {
    console.info(
      "Stage 1 worker runtime is idle. Set WORKER_BOOT_MODE=run, provide a database URL, configure the Gmail live and Salesforce capture ports, and use the worker .mbox import command for historical Gmail backfill.",
    );
    return null;
  }

  const runtime = await createStage1WorkerRuntimeServices(config);

  try {
    const runner = await run({
      connectionString: config.connectionString,
      concurrency: config.concurrency,
      crontab: buildWorkerCrontab(config),
      noHandleSignals: true,
      pollInterval: 2000,
      taskList: runtime.taskList,
    });

    void runner.promise
      .finally(() => runtime.dispose())
      .catch((error: unknown) => {
        console.error("Stage 1 worker runtime cleanup failed.");
        console.error(error instanceof Error ? error.message : String(error));
      });

    return runner;
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
