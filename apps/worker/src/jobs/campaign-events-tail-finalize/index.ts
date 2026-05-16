import type { Task } from "graphile-worker";

import {
  runCampaignEventsTailFinalize,
  type CampaignEventsTailFinalizeDependencies,
} from "./finalize.js";

export { campaignEventsTailFinalizeJobName } from "./finalize.js";
export {
  runCampaignEventsTailFinalize,
  type CampaignEventsTailFinalizeDependencies,
} from "./finalize.js";

export function createCampaignEventsTailFinalizeTask(
  dependencies: CampaignEventsTailFinalizeDependencies,
): Task {
  return async () => {
    await runCampaignEventsTailFinalize(dependencies);
  };
}
