import { randomUUID } from "node:crypto";

import type { Task } from "graphile-worker";

import {
  campaignResendPayloadSchema,
  campaignSendJobMaxAttempts,
  campaignSendJobName,
  campaignSendPayloadSchema,
  type AuditEvidenceRecord,
  type AudienceSnapshotRecord,
  type CampaignRunRecord,
} from "@as-comms/contracts";
import {
  selectResendRecipients,
  type CampaignSendOrchestrator,
} from "@as-comms/domain";

export {
  campaignResendJobName,
  campaignResendJobMaxAttempts,
  campaignResendPayloadSchema,
} from "@as-comms/contracts";
export type { CampaignResendPayload } from "@as-comms/contracts";

export interface CampaignResendTaskDependencies {
  readonly campaignRuns: {
    findById(id: string): Promise<CampaignRunRecord | null>;
  };
  readonly audienceSnapshots: {
    listForRun(runId: string): Promise<readonly AudienceSnapshotRecord[]>;
  };
  readonly audienceComposition: {
    openedSnapshotIdsForRun(runId: string): Promise<readonly string[]>;
    clickedSnapshotIdsForRun(runId: string): Promise<readonly string[]>;
  };
  readonly orchestrator: CampaignSendOrchestrator;
  readonly auditEvidence: {
    append(record: AuditEvidenceRecord): Promise<AuditEvidenceRecord>;
  };
}

export function createCampaignResendTask(
  dependencies: CampaignResendTaskDependencies,
): Task {
  return async (payload, helpers) => {
    const { childRunId } = campaignResendPayloadSchema.parse(payload);
    const child = await dependencies.campaignRuns.findById(childRunId);
    if (child?.resendOfRunId == null || child.state === "cancelled") {
      return;
    }

    const parent = await dependencies.campaignRuns.findById(child.resendOfRunId);
    if (parent?.state !== "complete" || child.state !== "draft") {
      return;
    }

    const [parentSnapshots, openedSnapshotIds, clickedSnapshotIds] = await Promise.all([
      dependencies.audienceSnapshots.listForRun(parent.id),
      dependencies.audienceComposition.openedSnapshotIdsForRun(parent.id),
      dependencies.audienceComposition.clickedSnapshotIdsForRun(parent.id),
    ]);
    const recipients = selectResendRecipients({
      parentSnapshots,
      openedSnapshotIds,
      clickedSnapshotIds,
    });
    const firedAt = new Date();
    await dependencies.orchestrator.freezeWithAudience(child.id, recipients, firedAt);
    await helpers.addJob(
      campaignSendJobName,
      campaignSendPayloadSchema.parse({ runId: child.id }),
      {
        jobKey: `campaign-send:${child.id}`,
        jobKeyMode: "replace",
        maxAttempts: campaignSendJobMaxAttempts,
      },
    );
    await dependencies.auditEvidence.append({
      id: randomUUID(),
      actorType: "system",
      actorId: "campaign-resend",
      action: "campaign_run.resend_fired",
      entityType: "campaign_run",
      entityId: child.id,
      occurredAt: firedAt.toISOString(),
      result: "recorded",
      policyCode: "stage5a.campaign_run.resend_fired",
      metadataJson: { parentRunId: parent.id, selectedRecipients: recipients.length },
    });
  };
}
