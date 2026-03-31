import { run, type Runner, type TaskList } from "graphile-worker";
import { z } from "zod";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection,
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
  readStage1LaunchScopeConfig,
  stage1LaunchScopeConfigSchema,
  type Stage1SafeRuntimeConfigSummary
} from "./ops/config.js";
import {
  createStage1WorkerOrchestrationService,
  type MailchimpCapturePort,
  type SimpleTextingCapturePort,
  type Stage1WorkerOrchestrationService
} from "./orchestration/index.js";
import { createTaskList } from "./tasks.js";

const workerCaptureConfigSchema = z.object({
  gmail: capturePortHttpConfigSchema,
  salesforce: capturePortHttpConfigSchema,
  simpleTexting: capturePortHttpConfigSchema.optional(),
  mailchimp: capturePortHttpConfigSchema.optional()
});

const workerConfigSchema = z.object({
  connectionString: z.string().min(1),
  concurrency: z.number().int().positive().default(1),
  launchScope: stage1LaunchScopeConfigSchema,
  capture: workerCaptureConfigSchema
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export interface Stage1WorkerRuntimeServices {
  readonly connection: DatabaseConnection;
  readonly orchestration: Stage1WorkerOrchestrationService;
  readonly taskList: TaskList;
  dispose(): Promise<void>;
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
    }
  });
}

export function buildSafeRuntimeConfigSummary(
  config: WorkerConfig
): Stage1SafeRuntimeConfigSummary {
  return {
    concurrency: config.concurrency,
    gmail: {
      historicalMailboxes: config.launchScope.gmail.historicalMailboxes,
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

export function createStage1WorkerRuntimeServices(
  config: WorkerConfig,
  input?: {
    readonly fetchImplementation?: FetchImplementation;
  }
): Stage1WorkerRuntimeServices {
  const connection = createDatabaseConnection({
    connectionString: config.connectionString
  });
  const repositories = createStage1RepositoryBundleFromConnection(connection);
  const persistence = createStage1PersistenceService(repositories);
  const normalization = createStage1NormalizationService(persistence);
  const ingest = createStage1IngestService(normalization);
  const fetchOptions =
    input?.fetchImplementation === undefined
      ? undefined
      : {
          fetchImplementation: input.fetchImplementation
        };
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
  const orchestration = createStage1WorkerOrchestrationService({
    capture,
    ingest,
    normalization,
    persistence
  });

  return {
    connection,
    orchestration,
    taskList: createTaskList(orchestration),
    dispose() {
      return closeDatabaseConnection(connection);
    }
  };
}

export async function startWorker(
  env: NodeJS.ProcessEnv = process.env
): Promise<Runner | null> {
  const config = readWorkerConfig(env);

  if (!config) {
    console.info(
      "Stage 1 worker runtime is idle. Set WORKER_BOOT_MODE=run, provide a database URL, and configure Gmail + Salesforce capture ports to start the narrowed launch-scope worker."
    );
    return null;
  }

  const runtime = createStage1WorkerRuntimeServices(config);

  try {
    const runner = await run({
      connectionString: config.connectionString,
      concurrency: config.concurrency,
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
