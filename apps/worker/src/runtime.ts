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
  type FetchImplementation
} from "@as-comms/integrations";

import { createStage1IngestService } from "./ingest/index.js";
import {
  createStage1WorkerOrchestrationService,
  type Stage1WorkerOrchestrationService
} from "./orchestration/index.js";
import { createTaskList } from "./tasks.js";

const workerCaptureConfigSchema = z.object({
  gmail: capturePortHttpConfigSchema,
  salesforce: capturePortHttpConfigSchema,
  simpleTexting: capturePortHttpConfigSchema,
  mailchimp: capturePortHttpConfigSchema
});

const workerConfigSchema = z.object({
  connectionString: z.string().min(1),
  concurrency: z.number().int().positive().default(1),
  capture: workerCaptureConfigSchema
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export interface Stage1WorkerRuntimeServices {
  readonly connection: DatabaseConnection;
  readonly orchestration: Stage1WorkerOrchestrationService;
  readonly taskList: TaskList;
  dispose(): Promise<void>;
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
    capture: {
      gmail: {
        baseUrl: env.GMAIL_CAPTURE_BASE_URL,
        bearerToken: env.GMAIL_CAPTURE_TOKEN
      },
      salesforce: {
        baseUrl: env.SALESFORCE_CAPTURE_BASE_URL,
        bearerToken: env.SALESFORCE_CAPTURE_TOKEN
      },
      simpleTexting: {
        baseUrl: env.SIMPLETEXTING_CAPTURE_BASE_URL,
        bearerToken: env.SIMPLETEXTING_CAPTURE_TOKEN
      },
      mailchimp: {
        baseUrl: env.MAILCHIMP_CAPTURE_BASE_URL,
        bearerToken: env.MAILCHIMP_CAPTURE_TOKEN
      }
    }
  });
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
    simpleTexting: createSimpleTextingCapturePort(
      config.capture.simpleTexting,
      fetchOptions
    ),
    mailchimp: createMailchimpCapturePort(config.capture.mailchimp, fetchOptions)
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
      "Stage 1 worker runtime is idle. Set WORKER_BOOT_MODE=run, provide a database URL, and configure all provider capture ports to start Graphile Worker."
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
