import { run, type Runner } from "graphile-worker";
import { z } from "zod";

import { createTaskList } from "./tasks.js";

const workerConfigSchema = z.object({
  connectionString: z.string().min(1),
  concurrency: z.number().int().positive().default(1)
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function readWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig | null {
  if (env.WORKER_BOOT_MODE !== "run") {
    return null;
  }

  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  return workerConfigSchema.parse({
    connectionString,
    concurrency: 1
  });
}

export async function startWorker(
  env: NodeJS.ProcessEnv = process.env
): Promise<Runner | null> {
  const config = readWorkerConfig(env);

  if (!config) {
    console.info(
      "Stage 0 worker scaffold loaded. Set WORKER_BOOT_MODE=run and a database URL to start Graphile Worker."
    );
    return null;
  }

  return run({
    connectionString: config.connectionString,
    concurrency: config.concurrency,
    noHandleSignals: true,
    pollInterval: 2000,
    taskList: createTaskList()
  });
}
