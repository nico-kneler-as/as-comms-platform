import type { TaskList } from "graphile-worker";

import { noopJobName } from "@as-comms/contracts";

import {
  createCampaignEventsTailFinalizeTask,
  campaignEventsTailFinalizeJobName,
  type CampaignEventsTailFinalizeDependencies,
} from "./jobs/campaign-events-tail-finalize/index.js";
import {
  createCampaignSendTask,
  campaignSendJobName,
  type CampaignSendTaskDependencies,
} from "./jobs/campaign-send/index.js";
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
  createReconcileSalesforceStateTask,
  reconcileSalesforceStateJobName,
  type ReconcileSalesforceStateTaskDependencies,
} from "./jobs/reconcile-salesforce-state.js";
import {
  createReconcileSupersededProjectionsTask,
  reconcileSupersededProjectionsJobName,
  type ReconcileSupersededProjectionsTaskDependencies,
} from "./jobs/reconcile-superseded-projections.js";
import {
  createReconcileStrandedCampaignRunsTask,
  reconcileStrandedCampaignRunsJobName,
  type ReconcileStrandedCampaignRunsTaskDependencies,
} from "./jobs/reconcile-stranded-campaign-runs.js";
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
  createPollPostmarkSenderStatusTask,
  pollPostmarkSenderStatusJobName,
  type PollPostmarkSenderStatusDependencies,
} from "./jobs/poll-postmark-sender-status/index.js";
import {
  createSynthesizeProjectKnowledgeTask,
  synthesizeProjectKnowledgeJobName,
  type SynthesizeProjectKnowledgeDependencies,
} from "./jobs/synthesize-project-knowledge/index.js";
import { runStage0NoopJob } from "./jobs/noop.js";
import {
  createStage1TaskList,
  type IntegrationHealthTaskDependencies,
  type IntegrationBackfillGmailTaskDependencies,
  type PollAiKnowledgeAutoSyncTaskDependencies,
  type Stage1WorkerOrchestrationService,
} from "./orchestration/index.js";

export function createTaskList(
  orchestration?: Stage1WorkerOrchestrationService,
  input?: {
    readonly campaignSend?: CampaignSendTaskDependencies;
    readonly campaignEventsTailFinalize?: CampaignEventsTailFinalizeDependencies;
    readonly dedupHistoricalLedger?: DedupHistoricalLedgerTaskDependencies;
    readonly integrationHealth?: IntegrationHealthTaskDependencies;
    readonly integrationBackfill?: IntegrationBackfillGmailTaskDependencies;
    readonly aiKnowledgeAutoSync?: PollAiKnowledgeAutoSyncTaskDependencies;
    readonly notionKnowledgeSync?: NotionKnowledgeSyncDependencies;
    readonly pendingOutboundSweep?: PendingOutboundSweepTaskDependencies;
    readonly reconcileIdentityQueue?: ReconcileIdentityQueueTaskDependencies;
    readonly reconcileRoutingReviewQueue?: ReconcileRoutingReviewQueueTaskDependencies;
    readonly reconcileCaptureGaps?: ReconcileCaptureGapsTaskDependencies;
    readonly reconcileStaleRunning?: ReconcileStaleRunningTaskDependencies;
    readonly reconcileSalesforceState?: ReconcileSalesforceStateTaskDependencies;
    readonly reconcileSupersededProjections?: ReconcileSupersededProjectionsTaskDependencies;
    readonly reconcileStrandedCampaignRuns?: ReconcileStrandedCampaignRunsTaskDependencies;
    readonly synthesizeProjectKnowledge?: SynthesizeProjectKnowledgeDependencies;
    readonly pollPostmarkSenderStatus?: PollPostmarkSenderStatusDependencies;
  },
): TaskList {
  return {
    [noopJobName]: runStage0NoopJob,
    ...(input?.campaignSend === undefined
      ? {}
      : {
          [campaignSendJobName]: createCampaignSendTask(input.campaignSend),
        }),
    ...(input?.campaignEventsTailFinalize === undefined
      ? {}
      : {
          [campaignEventsTailFinalizeJobName]:
            createCampaignEventsTailFinalizeTask(
              input.campaignEventsTailFinalize,
            ),
        }),
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
    ...(input?.reconcileSalesforceState === undefined
      ? {}
      : {
          [reconcileSalesforceStateJobName]:
            createReconcileSalesforceStateTask(
              input.reconcileSalesforceState,
            ),
        }),
    ...(input?.reconcileSupersededProjections === undefined
      ? {}
      : {
          [reconcileSupersededProjectionsJobName]:
            createReconcileSupersededProjectionsTask(
              input.reconcileSupersededProjections,
            ),
        }),
    ...(input?.reconcileStrandedCampaignRuns === undefined
      ? {}
      : {
          [reconcileStrandedCampaignRunsJobName]:
            createReconcileStrandedCampaignRunsTask(
              input.reconcileStrandedCampaignRuns,
            ),
        }),
    ...(input?.notionKnowledgeSync === undefined
      ? {}
      : {
          [notionKnowledgeSyncJobName]: createNotionKnowledgeSyncTask(
            input.notionKnowledgeSync,
          ),
        }),
    ...(input?.pollPostmarkSenderStatus === undefined
      ? {}
      : {
          [pollPostmarkSenderStatusJobName]: createPollPostmarkSenderStatusTask(
            input.pollPostmarkSenderStatus,
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
