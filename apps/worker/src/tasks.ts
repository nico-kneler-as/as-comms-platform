import type { TaskList } from "graphile-worker";

import { noopJobName } from "@as-comms/contracts";

import {
  createDedupHistoricalLedgerTask,
  dedupHistoricalLedgerJobName,
  type DedupHistoricalLedgerTaskDependencies,
} from "./jobs/dedup-historical-ledger.js";
import {
  createSweepPendingOutboundsTask,
  sweepPendingOutboundsJobName,
  type PendingOutboundSweepTaskDependencies,
} from "./jobs/sweep-pending-outbounds.js";
import {
  createReconcileIdentityQueueTask,
  reconcileIdentityQueueJobName,
  type ReconcileIdentityQueueTaskDependencies,
} from "./jobs/reconcile-identity-queue.js";
import {
  createReconcileRoutingReviewQueueTask,
  reconcileRoutingReviewQueueJobName,
  type ReconcileRoutingReviewQueueTaskDependencies,
} from "./jobs/reconcile-routing-review-queue.js";
import {
  createReconcileStaleRunningTask,
  reconcileStaleRunningJobName,
  type ReconcileStaleRunningTaskDependencies,
} from "./jobs/reconcile-stale-running.js";
import {
  createReconcileCaptureGapsTask,
  reconcileCaptureGapsJobName,
  type ReconcileCaptureGapsTaskDependencies,
} from "./jobs/reconcile-capture-gaps.js";
import {
  createNotionKnowledgeSyncTask,
  notionKnowledgeSyncJobName,
  type NotionKnowledgeSyncDependencies,
} from "./jobs/notion-knowledge-sync/index.js";
import {
  createSynthesizeProjectKnowledgeTask,
  synthesizeProjectKnowledgeJobName,
  type SynthesizeProjectKnowledgeDependencies,
} from "./jobs/synthesize-project-knowledge/index.js";
import { runStage0NoopJob } from "./jobs/noop.js";
import {
  createStage1TaskList,
  type IntegrationHealthTaskDependencies,
  type Stage1WorkerOrchestrationService,
} from "./orchestration/index.js";

export function createTaskList(
  orchestration?: Stage1WorkerOrchestrationService,
  input?: {
    readonly dedupHistoricalLedger?: DedupHistoricalLedgerTaskDependencies;
    readonly integrationHealth?: IntegrationHealthTaskDependencies;
    readonly notionKnowledgeSync?: NotionKnowledgeSyncDependencies;
    readonly pendingOutboundSweep?: PendingOutboundSweepTaskDependencies;
    readonly reconcileIdentityQueue?: ReconcileIdentityQueueTaskDependencies;
    readonly reconcileRoutingReviewQueue?: ReconcileRoutingReviewQueueTaskDependencies;
    readonly reconcileCaptureGaps?: ReconcileCaptureGapsTaskDependencies;
    readonly reconcileStaleRunning?: ReconcileStaleRunningTaskDependencies;
    readonly synthesizeProjectKnowledge?: SynthesizeProjectKnowledgeDependencies;
  },
): TaskList {
  return {
    [noopJobName]: runStage0NoopJob,
    ...(input?.pendingOutboundSweep === undefined
      ? {}
      : {
          [sweepPendingOutboundsJobName]: createSweepPendingOutboundsTask(
            input.pendingOutboundSweep,
          ),
        }),
    ...(input?.dedupHistoricalLedger === undefined
      ? {}
      : {
          [dedupHistoricalLedgerJobName]: createDedupHistoricalLedgerTask(
            input.dedupHistoricalLedger,
          ),
        }),
    ...(input?.reconcileIdentityQueue === undefined
      ? {}
      : {
          [reconcileIdentityQueueJobName]: createReconcileIdentityQueueTask(
            input.reconcileIdentityQueue,
          ),
        }),
    ...(input?.reconcileRoutingReviewQueue === undefined
      ? {}
      : {
          [reconcileRoutingReviewQueueJobName]:
            createReconcileRoutingReviewQueueTask(
              input.reconcileRoutingReviewQueue,
            ),
        }),
    ...(input?.reconcileCaptureGaps === undefined
      ? {}
      : {
          [reconcileCaptureGapsJobName]: createReconcileCaptureGapsTask(
            input.reconcileCaptureGaps
          )
        }),
    ...(input?.reconcileStaleRunning === undefined
      ? {}
      : {
          [reconcileStaleRunningJobName]: createReconcileStaleRunningTask(
            input.reconcileStaleRunning
          )
        }),
    ...(input?.notionKnowledgeSync === undefined
      ? {}
      : {
          [notionKnowledgeSyncJobName]: createNotionKnowledgeSyncTask(
            input.notionKnowledgeSync,
          ),
        }),
    ...(input?.synthesizeProjectKnowledge === undefined
      ? {}
      : {
          [synthesizeProjectKnowledgeJobName]:
            createSynthesizeProjectKnowledgeTask(
              input.synthesizeProjectKnowledge,
            ),
        }),
    ...(orchestration ? createStage1TaskList(orchestration, input) : {}),
  };
}
