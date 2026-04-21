import type { TaskList } from "graphile-worker";

import { noopJobName } from "@as-comms/contracts";

import {
  createSweepPendingOutboundsTask,
  sweepPendingOutboundsJobName,
  type PendingOutboundSweepTaskDependencies
} from "./jobs/sweep-pending-outbounds.js";
import {
  createNotionKnowledgeSyncTask,
  notionKnowledgeSyncJobName,
  type NotionKnowledgeSyncDependencies
} from "./jobs/notion-knowledge-sync/index.js";
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
    readonly notionKnowledgeSync?: NotionKnowledgeSyncDependencies;
    readonly pendingOutboundSweep?: PendingOutboundSweepTaskDependencies;
  }
): TaskList {
  return {
    [noopJobName]: runStage0NoopJob,
    ...(input?.pendingOutboundSweep === undefined
      ? {}
      : {
          [sweepPendingOutboundsJobName]: createSweepPendingOutboundsTask(
            input.pendingOutboundSweep
          )
        }),
    ...(input?.notionKnowledgeSync === undefined
      ? {}
      : {
          [notionKnowledgeSyncJobName]: createNotionKnowledgeSyncTask(
            input.notionKnowledgeSync
          )
        }),
    ...(orchestration ? createStage1TaskList(orchestration, input) : {})
  };
}
