import type { Task } from "graphile-worker";

import {
  salesforceProjectBoxesCaptureResponseSchema,
  salesforceProjectBoxesSyncJobMaxAttempts,
  salesforceProjectBoxesSyncJobName,
  salesforceProjectBoxesSyncPayloadSchema,
  salesforceSubscriptionBoxValues,
} from "@as-comms/contracts";
import type { ProjectDimensionRepository } from "@as-comms/domain";

export {
  salesforceProjectBoxesSyncJobMaxAttempts,
  salesforceProjectBoxesSyncJobName,
};

export interface SalesforceProjectBoxesSyncTaskDependencies {
  readonly capture: {
    captureProjectSubscriptionBoxes(input: {
      readonly version: 1;
    }): Promise<unknown>;
  };
  readonly repository: Pick<
    ProjectDimensionRepository,
    "replaceProjectSubscriptionBoxes"
  >;
  readonly logger?: Pick<Console, "error" | "info">;
}

const MAX_LOGGED_ERROR_LENGTH = 500;

function errorMessage(error: unknown): string {
  const source =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  const message = source instanceof Error ? source.message : String(source);
  return message.length > MAX_LOGGED_ERROR_LENGTH
    ? `${message.slice(0, MAX_LOGGED_ERROR_LENGTH)}…`
    : message;
}

export function createSalesforceProjectBoxesSyncTask(
  dependencies: SalesforceProjectBoxesSyncTaskDependencies,
): Task {
  const logger = dependencies.logger ?? console;
  return async (payload) => {
    try {
      salesforceProjectBoxesSyncPayloadSchema.parse(payload);
      const captured =
        await dependencies.capture.captureProjectSubscriptionBoxes({
          version: 1,
        });
      const snapshot =
        salesforceProjectBoxesCaptureResponseSchema.parse(captured);
      const replacement =
        await dependencies.repository.replaceProjectSubscriptionBoxes(
          snapshot.rows,
          new Date(snapshot.capturedAt),
        );
      const values = new Set<string>(salesforceSubscriptionBoxValues);
      logger.info(
        JSON.stringify({
          event: "salesforce.project_boxes.sync.succeeded",
          rows_captured: snapshot.rows.length,
          updated: replacement.updated,
          cleared: replacement.cleared,
          unknown_project_ids: replacement.unknownProjectIds.length,
          unknown_box_values: snapshot.rows.filter(
            (row) =>
              row.subscriptionBox !== null &&
              !values.has(row.subscriptionBox as never),
          ).length,
        }),
      );
    } catch (error) {
      logger.error(
        JSON.stringify({
          event: "salesforce.project_boxes.sync.failed",
          error: errorMessage(error),
        }),
      );
      throw error;
    }
  };
}
