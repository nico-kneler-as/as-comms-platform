import type { TaskList } from "graphile-worker";

import { noopJobName } from "@as-comms/contracts";

import { runStage0NoopJob } from "./jobs/noop.js";
import {
  createStage1TaskList,
  type IntegrationHealthTaskDependencies,
  type Stage1WorkerOrchestrationService
} from "./orchestration/index.js";

export function createTaskList(
  orchestration?: Stage1WorkerOrchestrationService,
  input?: {
    readonly integrationHealth?: IntegrationHealthTaskDependencies;
  }
): TaskList {
  return {
    [noopJobName]: runStage0NoopJob,
    ...(orchestration ? createStage1TaskList(orchestration, input) : {})
  };
}
