import type { Task } from "graphile-worker";

import {
  salesforceContactStatesSnapshotSchema,
  salesforceContactStatesSyncJobMaxAttempts,
  salesforceContactStatesSyncJobName,
  salesforceContactStatesSyncPayloadSchema,
} from "@as-comms/contracts";
import type { SalesforceContactStatesRepository } from "@as-comms/db";
import { buildSalesforceContactStateRows } from "@as-comms/domain";

export {
  salesforceContactStatesSyncJobMaxAttempts,
  salesforceContactStatesSyncJobName,
};

export interface SalesforceContactStatesSyncTaskDependencies {
  readonly capture: {
    captureContactStates(input: { readonly version: 1 }): Promise<unknown>;
  };
  readonly repository: SalesforceContactStatesRepository;
  readonly logger?: Pick<Console, "error" | "info">;
}

const MAX_LOGGED_ERROR_LENGTH = 500;

// Drizzle query errors embed every bound parameter (here: up to 1,000
// emails per insert chunk) in `message`; log the underlying driver error
// instead, truncated, so a failed sync never dumps addresses into logs.
function errorMessage(error: unknown): string {
  const source =
    error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const message = source instanceof Error ? source.message : String(source);
  return message.length > MAX_LOGGED_ERROR_LENGTH
    ? `${message.slice(0, MAX_LOGGED_ERROR_LENGTH)}…`
    : message;
}

export function createSalesforceContactStatesSyncTask(
  dependencies: SalesforceContactStatesSyncTaskDependencies,
): Task {
  const logger = dependencies.logger ?? console;

  return async (payload) => {
    try {
      salesforceContactStatesSyncPayloadSchema.parse(payload);
      const captured = await dependencies.capture.captureContactStates({ version: 1 });
      const snapshot = salesforceContactStatesSnapshotSchema.parse(captured);
      const { records, stats } = buildSalesforceContactStateRows(snapshot.rows);
      await dependencies.repository.replaceAll(records, new Date(snapshot.capturedAt));
      logger.info(JSON.stringify({
        event: "salesforce.contact_states.sync.succeeded",
        rows_captured: snapshot.rows.length,
        stored: records.length,
        with_state_code: stats.withStateCode,
        without_state_code: stats.withoutStateCode,
        with_opt_out: stats.withOptOut,
        duplicates_collapsed: stats.duplicatesCollapsed,
        dropped_invalid_email: stats.droppedInvalidEmail,
        captured_at: snapshot.capturedAt,
      }));
    } catch (error) {
      logger.error(JSON.stringify({
        event: "salesforce.contact_states.sync.failed",
        error: errorMessage(error),
      }));
      throw error;
    }
  };
}
