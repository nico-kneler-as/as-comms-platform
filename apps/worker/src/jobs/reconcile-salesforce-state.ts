import type { Task } from "graphile-worker";

import type { Stage1Database } from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";
import type {
  SalesforceApiClient,
  SalesforceCaptureServiceConfig,
} from "@as-comms/integrations";

import {
  reconcileSalesforceState,
  type ReconcileSalesforceStateMode,
} from "../ops/reconcile-salesforce-state.js";

export const reconcileSalesforceStateJobName =
  "reconcile-salesforce-state" as const;

export interface ReconcileSalesforceStateTaskDependencies {
  readonly db: Stage1Database;
  readonly repositories: Stage1RepositoryBundle;
  readonly apiClient: SalesforceApiClient;
  readonly mode: ReconcileSalesforceStateMode;
  readonly salesforceConfig: SalesforceCaptureServiceConfig;
  readonly now?: () => Date;
  readonly logger?: Pick<Console, "log" | "warn">;
}

export function createReconcileSalesforceStateTask(
  dependencies: ReconcileSalesforceStateTaskDependencies,
): Task {
  const logger = dependencies.logger ?? console;

  return () =>
    reconcileSalesforceState({
      db: dependencies.db,
      repositories: dependencies.repositories,
      apiClient: dependencies.apiClient,
      mode: dependencies.mode,
      salesforceConfig: dependencies.salesforceConfig,
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      logger,
    }).then((report) => {
      const totalErrors = report.runs.reduce(
        (sum, run) => sum + run.errors.length,
        0,
      );

      logger.log(
        JSON.stringify({
          event: "salesforce.reconciliation.run.summary",
          entityCount: report.runs.length,
          totalErrors,
        }),
      );

      if (totalErrors > 0) {
        logger.log(
          JSON.stringify({
            event: "salesforce.reconciliation.run.errors",
            sample: report.runs
              .flatMap((run) =>
                run.errors.map((error) => ({
                  entityType: run.entityType,
                  ...error,
                })),
              )
              .slice(0, 5),
          }),
        );
      }
    });
}
