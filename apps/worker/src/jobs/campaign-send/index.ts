import type { Task } from "graphile-worker";

import { campaignSendPayloadSchema } from "@as-comms/contracts";
import type { CampaignSendOrchestrator } from "@as-comms/domain";

export interface CampaignSendTaskDependencies {
  readonly orchestrator: CampaignSendOrchestrator;
}

export {
  campaignSendJobName,
  campaignSendJobMaxAttempts,
  campaignSendPayloadSchema,
} from "@as-comms/contracts";
export type { CampaignSendPayload } from "@as-comms/contracts";

export function createCampaignSendTask(
  dependencies: CampaignSendTaskDependencies,
): Task {
  return async (payload) => {
    const parsed = campaignSendPayloadSchema.parse(payload);
    await dependencies.orchestrator.processSendRequest(parsed.runId);
  };
}
