import { run, type Runner, type TaskList } from "graphile-worker";
import { z } from "zod";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
  createStage2RepositoryBundleFromConnection,
  type DatabaseConnection
} from "@as-comms/db";
import {
  createStage1NormalizationService,
  createStage1PersistenceService
} from "@as-comms/domain";
import {
  capturePortHttpConfigSchema,
  createGmailCapturePort,
  createMailchimpCapturePort,
  createSalesforceCapturePort,
  createSimpleTextingCapturePort,
  ProviderCaptureConfigError,
  type FetchImplementation
} from "@as-comms/integrations";

import { createStage1IngestService } from "./ingest/index.js";
import {
  Stage1WorkerConfigError,
  readProjectInboxAliasesFromDb,
  readStage1LaunchScopeConfig,
  stage1LaunchScopeConfigSchema,
  type Stage1SafeRuntimeConfigSummary
} from "./ops/config.js";
import {
  readNotionKnowledgeSyncConfig
} from "./jobs/notion-knowledge-sync/index.js";
import {
  createStage1WorkerOrchestrationService,
  type MailchimpCapturePort,
  pollGmailLiveJobName,
  pollIntegrationHealthJobName,
  pollSalesforceLiveJobName,
  type SimpleTextingCapturePort,
  type Stage1WorkerOrchestrationService
} from "./orchestration/index.js";
import { createTaskList } from "./tasks.js";
import { reconcileIdentityQueueJobName } from "./jobs/reconcile-identity-queue.js";
import { sweepPendingOutboundsJobName } from "./jobs/sweep-pending-outbounds.js";

const workerCaptureConfigSchema = z.object({
  gmail: capturePortHttpConfigSchema,
  salesforce: capturePortHttpConfigSchema,
  simpleTexting: capturePortHttpConfigSchema.optional(),
  mailchimp: capturePortHttpConfigSchema.optional()
});

const workerWebConfigSchema = z.object({
  revalidateBaseUrl: z.string().url(),
  revalidateToken: z.string().min(1)
});

const workerConfigSchema = z.object({
  connectionString: z.string().min(1),
  concurrency: z.number().int().positive().default(1),
  launchScope: stage1LaunchScopeConfigSchema,
  capture: workerCaptureConfigSchema,
  web: workerWebConfigSchema.optional()
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
      `${providerLabel} poll interval must be a whole-number multiple of 60 seconds for Graphile Worker crontab scheduling.`
    );
  }

  return seconds / 60;
}

export function buildWorkerCrontab(config: WorkerConfig): string {
  const gmailMinutes = toCronMinuteInterval(
    "Gmail live",
    config.launchScope.gmail.livePollIntervalSeconds
  );
  const salesforceMinutes = toCronMinuteInterval(
    "Salesforce Task",
    config.launchScope.salesforce.taskPollIntervalSeconds
  );

  return [
    `*/${String(gmailMinutes)} * * * * ${pollGmailLiveJobName} ?id=gmail-live-poll&max=1`,
    `*/${String(salesforceMinutes)} * * * * ${pollSalesforceLiveJobName} ?id=salesforce-live-poll&max=1`,
    `*/5 * * * * ${pollIntegrationHealthJobName} ?id=integration-health-poll&max=1`,
    `*/5 * * * * ${sweepPendingOutboundsJobName} ?id=composer-orphan-sweep&max=1`,
    `*/15 * * * * ${reconcileIdentityQueueJobName} ?id=identity-queue-reconcile&max=1`
  ].join("\n");
}

function readOptionalCaptureConfig(
  env: NodeJS.ProcessEnv,
  input: {
    readonly baseUrlKey: string;
    readonly tokenKey: string;
  }
): { readonly baseUrl?: string; readonly bearerToken?: string } | undefined {
  const baseUrl = env[input.baseUrlKey];
  const bearerToken = env[input.tokenKey];

  if (baseUrl === undefined && bearerToken === undefined) {
    return undefined;
  }

  return {
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(bearerToken === undefined ? {} : { bearerToken })
  };
}

function buildDeferredLaunchScopeMessage(providerLabel: string): string {
  return `${providerLabel} capture is deferred for the narrowed Gmail + Salesforce Stage 1 launch scope. Configure this capture port only when resuming non-launch providers.`;
}

function readOptionalWebConfig(
  env: NodeJS.ProcessEnv
):
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
    ...(revalidateToken === undefined ? {} : { revalidateToken })
  };
}

function rejectDeferredLaunchScopeProvider(providerLabel: string): Promise<never> {
  return Promise.reject(
    new ProviderCaptureConfigError(
      buildDeferredLaunchScopeMessage(providerLabel)
    )
  );
}

function createDeferredSimpleTextingCapturePort(): SimpleTextingCapturePort {
  return {
    captureHistoricalBatch: () =>
      rejectDeferredLaunchScopeProvider("SimpleTexting"),
    captureLiveBatch: () => rejectDeferredLaunchScopeProvider("SimpleTexting")
  };
}

function createDeferredMailchimpCapturePort(): MailchimpCapturePort {
  return {
    captureHistoricalBatch: () => rejectDeferredLaunchScopeProvider("Mailchimp"),
    captureTransitionBatch: () => rejectDeferredLaunchScopeProvider("Mailchimp")
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
        bearerToken: env.GMAIL_CAPTURE_TOKEN
      },
      salesforce: {
        baseUrl: env.SALESFORCE_CAPTURE_BASE_URL,
        bearerToken: env.SALESFORCE_CAPTURE_TOKEN
      },
      simpleTexting: readOptionalCaptureConfig(env, {
        baseUrlKey: "SIMPLETEXTING_CAPTURE_BASE_URL",
        tokenKey: "SIMPLETEXTING_CAPTURE_TOKEN"
      }),
      mailchimp: readOptionalCaptureConfig(env, {
        baseUrlKey: "MAILCHIMP_CAPTURE_BASE_URL",
        tokenKey: "MAILCHIMP_CAPTURE_TOKEN"
      })
    },
    web: readOptionalWebConfig(env)
  });
}

export function buildSafeRuntimeConfigSummary(
  config: WorkerConfig
): Stage1SafeRuntimeConfigSummary {
  return {
    concurrency: config.concurrency,
    gmail: {
      historicalBackfillMode: config.launchScope.gmail.historicalBackfillMode,
      liveAccount: config.launchScope.gmail.liveAccount,
      projectInboxAliases: config.launchScope.gmail.projectInboxAliases,
      livePollIntervalSeconds: config.launchScope.gmail.livePollIntervalSeconds,
      captureBaseUrl: config.capture.gmail.baseUrl
    },
    salesforce: {
      contactCaptureMode: config.launchScope.salesforce.contactCaptureMode,
      membershipCaptureMode: config.launchScope.salesforce.membershipCaptureMode,
      taskPollIntervalSeconds: config.launchScope.salesforce.taskPollIntervalSeconds,
      captureBaseUrl: config.capture.salesforce.baseUrl
    },
    deferredProviders: {
      simpleTextingConfigured: config.capture.simpleTexting !== undefined,
      mailchimpConfigured: config.capture.mailchimp !== undefined
    }
  };
}

export async function createStage1WorkerRuntimeServices(
  config: WorkerConfig,
  input?: {
    readonly fetchImplementation?: FetchImplementation;
    readonly env?: NodeJS.ProcessEnv;
  }
): Promise<Stage1WorkerRuntimeServices> {
  const connection = createDatabaseConnection({
    connectionString: config.connectionString
  });

  // Prefer aliases from the DB; fall back to the env-var-derived config if the
  // project_aliases table is empty (bootstrap path — env var remains required).
  const dbAliases = await readProjectInboxAliasesFromDb(connection);
  const projectInboxAliases =
    dbAliases !== null && dbAliases.length > 0
      ? dbAliases
      : [...config.launchScope.gmail.projectInboxAliases];

  const repositories = createStage1RepositoryBundleFromConnection(connection);
  const settings = createStage2RepositoryBundleFromConnection(connection);
  const notionKnowledgeSync = readNotionKnowledgeSyncConfig(
    input?.env ?? process.env
  );
  const persistence = createStage1PersistenceService(repositories);
  const normalization = createStage1NormalizationService(persistence);
  const ingest = createStage1IngestService(normalization);
  const fetchOptions =
    input?.fetchImplementation === undefined
      ? undefined
      : {
          fetchImplementation: input.fetchImplementation
        };
  const fetchImplementation = input?.fetchImplementation ?? fetch;
  const capture = {
    gmail: createGmailCapturePort(config.capture.gmail, fetchOptions),
    salesforce: createSalesforceCapturePort(
      config.capture.salesforce,
      fetchOptions
    ),
    simpleTexting:
      config.capture.simpleTexting === undefined
        ? createDeferredSimpleTextingCapturePort()
        : createSimpleTextingCapturePort(
            config.capture.simpleTexting,
            fetchOptions
          ),
    mailchimp:
      config.capture.mailchimp === undefined
        ? createDeferredMailchimpCapturePort()
        : createMailchimpCapturePort(config.capture.mailchimp, fetchOptions)
  };
  const revalidateInboxViews = createWebInboxInvalidationPort(
    config.web,
    fetchImplementation
  );
  const orchestration = createStage1WorkerOrchestrationService({
    capture,
    ingest,
    normalization,
    persistence,
    livePolling: {
      gmailPollIntervalSeconds: config.launchScope.gmail.livePollIntervalSeconds,
      salesforcePollIntervalSeconds:
        config.launchScope.salesforce.taskPollIntervalSeconds
    },
    revalidateInboxViews,
    gmailHistoricalReplay: {
      liveAccount: config.launchScope.gmail.liveAccount,
      projectInboxAliases
    }
  });

  return {
    connection,
    orchestration,
    taskList: createTaskList(orchestration, {
      integrationHealth: {
        integrationHealth: settings.integrationHealth,
        captureBaseUrls: {
          gmail: config.capture.gmail.baseUrl,
          salesforce: config.capture.salesforce.baseUrl
        },
        fetchImplementation
      },
      notionKnowledgeSync: {
        db: connection.db,
        integrationHealth: settings.integrationHealth,
        notion: notionKnowledgeSync
      },
      pendingOutboundSweep: {
        pendingOutbounds: repositories.pendingOutbounds
      },
      reconcileIdentityQueue: {
        db: connection.db,
        repositories,
        capture,
        gmailHistoricalReplay: {
          liveAccount: config.launchScope.gmail.liveAccount,
          projectInboxAliases
        }
      }
    }),
    dispose() {
      return closeDatabaseConnection(connection);
    }
  };
}

function createWebInboxInvalidationPort(
  config: WorkerConfig["web"],
  fetchImplementation: FetchImplementation
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
          "content-type": "application/json"
        },
        body: JSON.stringify({
          contactIds: input.contactIds
        })
      }
    );

    if (!response.ok) {
      throw new Error(
        `Inbox revalidation failed with status ${response.status.toString()}.`
      );
    }
  };
}

export async function startWorker(
  env: NodeJS.ProcessEnv = process.env
): Promise<Runner | null> {
  const config = readWorkerConfig(env);

  if (!config) {
    console.info(
      "Stage 1 worker runtime is idle. Set WORKER_BOOT_MODE=run, provide a database URL, configure the Gmail live and Salesforce capture ports, and use the worker .mbox import command for historical Gmail backfill."
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
      taskList: runtime.taskList
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
