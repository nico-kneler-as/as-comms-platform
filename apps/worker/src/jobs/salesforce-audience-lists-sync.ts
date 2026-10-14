import type { Task } from "graphile-worker";

import {
  salesforceAudienceListsSnapshotSchema,
  salesforceAudienceListsSyncJobMaxAttempts,
  salesforceAudienceListsSyncJobName,
  salesforceAudienceListsSyncPayloadSchema,
} from "@as-comms/contracts";
import type { SalesforceAudienceListsRepository } from "@as-comms/db";

export {
  salesforceAudienceListsSyncJobMaxAttempts,
  salesforceAudienceListsSyncJobName,
};

export interface SalesforceAudienceListsSyncTaskDependencies {
  readonly capture: {
    captureAudienceLists(input: { readonly version: 1 }): Promise<unknown>;
  };
  readonly repository: SalesforceAudienceListsRepository;
  readonly logger?: Pick<Console, "error" | "info">;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSalesforceAudienceListsSyncTask(
  dependencies: SalesforceAudienceListsSyncTaskDependencies,
): Task {
  const logger = dependencies.logger ?? console;

  return async (payload) => {
    try {
      salesforceAudienceListsSyncPayloadSchema.parse(payload);
      const captured = await dependencies.capture.captureAudienceLists({
        version: 1,
      });
      const snapshot = salesforceAudienceListsSnapshotSchema.parse(captured);
      await dependencies.repository.replaceSnapshot(snapshot);
      logger.info(
        JSON.stringify({
          event: "salesforce.audience_lists.sync.succeeded",
          campaigns: snapshot.campaigns.length,
          members: snapshot.members.length,
          insiders: snapshot.insiders.length,
          captured_at: snapshot.capturedAt,
        }),
      );
    } catch (error) {
      logger.error(
        JSON.stringify({
          event: "salesforce.audience_lists.sync.failed",
          error: errorMessage(error),
        }),
      );
      // replaceSnapshot runs only after capture and contract validation, and its
      // transaction rolls back on failure; the prior durable snapshot survives.
      throw error;
    }
  };
}
