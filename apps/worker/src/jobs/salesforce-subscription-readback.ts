import type { Task } from "graphile-worker";

import {
  salesforceSubscriptionPreferencesCaptureResponseSchema,
  salesforceSubscriptionReadbackJobMaxAttempts,
  salesforceSubscriptionReadbackJobName,
  salesforceSubscriptionReadbackModeSchema,
  type SalesforceSubscriptionReadbackMode,
} from "@as-comms/contracts";
import type { SalesforceSubscriptionReadbackRepository } from "@as-comms/db";
import { planSubscriptionReadback } from "@as-comms/domain";

export {
  salesforceSubscriptionReadbackJobMaxAttempts,
  salesforceSubscriptionReadbackJobName,
};

export interface SalesforceSubscriptionReadbackTaskDependencies {
  readonly mode: SalesforceSubscriptionReadbackMode;
  readonly integrationUsername: string;
  readonly formsUsernames: readonly string[];
  readonly capture: {
    captureSubscriptionPreferences(input: {
      readonly version: 1;
      readonly since: string | null;
    }): Promise<unknown>;
  };
  readonly repository: SalesforceSubscriptionReadbackRepository;
  readonly logger?: Pick<Console, "info" | "error">;
}

export function createSalesforceSubscriptionReadbackTask(
  dependencies: SalesforceSubscriptionReadbackTaskDependencies,
): Task {
  const logger = dependencies.logger ?? console;
  return async () => {
    try {
      const mode = salesforceSubscriptionReadbackModeSchema.parse(
        dependencies.mode,
      );
      const count = await dependencies.repository.countMirror();
      const max =
        count === 0
          ? null
          : await dependencies.repository.maxMirrorModifiedAt();
      const since =
        max === null
          ? null
          : new Date(max.getTime() - 5 * 60 * 1000).toISOString();
      const captured =
        salesforceSubscriptionPreferencesCaptureResponseSchema.parse(
          await dependencies.capture.captureSubscriptionPreferences({
            version: 1,
            since,
          }),
        );
      const mirror = await dependencies.repository.loadMirror(
        captured.rows.map((row) => row.salesforceRecordId),
      );
      // A baseline run applies nothing, so it skips the per-record
      // contact and consent lookups (~6,600 records on the first run).
      const baseline = count === 0;
      const contactsByRecordId: ReadonlyMap<string, readonly string[]> =
        baseline
          ? new Map()
          : await dependencies.repository.loadContacts(captured.rows);
      const contactIds = [...new Set([...contactsByRecordId.values()].flat())];
      const [projectsByBox, platformState] = baseline
        ? [
            new Map<string, readonly string[]>(),
            {
              consentsByContact: new Map(),
              newsletterSubscribersByEmail: new Map(),
              newsletterSuppressionsByEmail: new Map(),
              suppressionEmails: new Set<string>(),
            },
          ]
        : await Promise.all([
            dependencies.repository.loadProjectsByBox(),
            dependencies.repository.loadPlatformState({
              emails: captured.rows.map((row) => row.email),
              contactIds,
            }),
          ]);
      const plan = planSubscriptionReadback({
        mode,
        baseline: count === 0,
        records: captured.rows,
        mirror,
        integrationUsername: dependencies.integrationUsername,
        formsUsernames: dependencies.formsUsernames,
        contactsByRecordId,
        projectsByBox,
        platformState,
      });
      for (let index = 0; index < plan.mirrorUpserts.length; index += 200) {
        const ids = new Set(
          plan.mirrorUpserts
            .slice(index, index + 200)
            .map((row) => row.salesforceRecordId),
        );
        await dependencies.repository.persistBatch({
          mode,
          mirrorUpserts: plan.mirrorUpserts
            .slice(index, index + 200)
            .map((row) => ({ ...row, capturedAt: captured.capturedAt })),
          events: plan.events.filter((event) =>
            ids.has(event.salesforceRecordId),
          ),
        });
      }
      // The audience gate uses a successful readback heartbeat rather than a
      // mirror row timestamp: an empty but healthy poll is still fresh data.
      await dependencies.repository.recordSuccessfulRefresh(new Date());
      const outcomes = Object.fromEntries(
        plan.events.reduce(
          (counts, event) =>
            counts.set(event.outcome, (counts.get(event.outcome) ?? 0) + 1),
          new Map<string, number>(),
        ),
      );
      logger.info(
        JSON.stringify({
          event: "salesforce.subscription_readback.run",
          mode,
          baseline: count === 0,
          captured: captured.rows.length,
          deleted: captured.rows.filter((row) => row.isDeleted).length,
          new_records: captured.rows.filter(
            (row) => !mirror.has(row.salesforceRecordId),
          ).length,
          transitions: plan.events.length,
          ...outcomes,
        }),
      );
    } catch (error) {
      logger.error(
        JSON.stringify({
          event: "salesforce.subscription_readback.failed",
          error:
            error instanceof Error && error.name === "ZodError"
              ? "invalid_capture_payload"
              : "readback_failed",
        }),
      );
      throw error;
    }
  };
}
