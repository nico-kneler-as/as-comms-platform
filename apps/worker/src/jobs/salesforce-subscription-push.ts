import type { Task } from "graphile-worker";

import { salesforceSubscriptionPushJobName } from "@as-comms/contracts";
import type {
  SalesforceSubscriptionOutboxRepository,
} from "@as-comms/db";
import { buildSubscriptionPreferenceChanges } from "@as-comms/domain";
import {
  SalesforceWriteError,
  type SalesforceWriteClient,
  type SubscriptionPreferenceUpsertResult,
} from "@as-comms/integrations";

import type { OpsAlertSender } from "../ops-alert/sender.js";

export { salesforceSubscriptionPushJobName };

export interface SalesforceSubscriptionPushTaskDependencies {
  readonly outbox: SalesforceSubscriptionOutboxRepository;
  readonly projectDimensions: {
    listProjectSubscriptionBoxes(): Promise<ReadonlyMap<string, string>>;
  };
  readonly writeClient: Pick<SalesforceWriteClient, "upsertSubscriptionPreferences">;
  readonly opsAlertSender: OpsAlertSender;
  readonly logger?: Pick<Console, "info" | "error">;
  readonly now?: () => Date;
}

interface RunCounts {
  created: number;
  updated: number;
  retried: number;
  parked: number;
}

export function createSalesforceSubscriptionPushTask(
  dependencies: SalesforceSubscriptionPushTaskDependencies,
): Task {
  const logger = dependencies.logger ?? console;
  const now = dependencies.now ?? (() => new Date());

  return async () => {
    const runAt = now();
    const rows = await dependencies.outbox.claimPending(500, runAt);
    // Runs every minute: stay silent when there is nothing to push.
    if (rows.length === 0) return;
    const counts: RunCounts = { created: 0, updated: 0, retried: 0, parked: 0 };
    let permissionErrorCode: string | null = null;
    const projectIds = [...new Set(rows.flatMap((row) => row.projectId ?? []))];
    const contactIds = [...new Set(rows.flatMap((row) => row.contactId ?? []))];
    const [projectBoxes, projectHosts, salesforceContactIds] = await Promise.all([
      dependencies.projectDimensions.listProjectSubscriptionBoxes(),
      dependencies.outbox.listProjectHosts(projectIds),
      dependencies.outbox.listSalesforceContactIds(contactIds),
    ]);
    const built = buildSubscriptionPreferenceChanges({
      rows,
      projectBoxes,
      projectHosts,
      salesforceContactIds,
    });

    const handleResult = async (
      result: SubscriptionPreferenceUpsertResult,
    ): Promise<void> => {
      const rowIds = built.rowIdsByEmail.get(result.email) ?? [];
      if (result.outcome === "created" || result.outcome === "updated") {
        await dependencies.outbox.markSent(rowIds, runAt);
        counts[result.outcome] += rowIds.length;
        return;
      }
      const error = result.error ?? {
        kind: "permanent" as const,
        code: "UNKNOWN_RESULT",
      };
      if (error.kind === "transient") {
        const transition = await dependencies.outbox.markTransient(
          rowIds,
          runAt,
          error.code,
        );
        counts.retried += transition.retried;
        counts.parked += transition.parked;
      } else if (error.kind === "permission") {
        counts.retried += await dependencies.outbox.deferPermission(
          rowIds,
          runAt,
          error.code,
        );
        permissionErrorCode = error.code;
      } else {
        counts.parked += await dependencies.outbox.markParked(
          rowIds,
          "permanent",
          error.code,
        );
      }
    };

    for (const skipped of built.skipped) {
      await dependencies.outbox.markSent([skipped.rowId], runAt, "NO_BOX");
    }

    if (built.changes.length > 0) {
      try {
        const results = await dependencies.writeClient.upsertSubscriptionPreferences(
          built.changes,
        );
        for (const result of results) await handleResult(result);
      } catch (error) {
        if (!(error instanceof SalesforceWriteError)) throw error;
        const completedEmails = new Set<string>();
        for (const result of error.completedResults) {
          completedEmails.add(result.email);
          await handleResult(result);
        }
        const remainingRowIds = built.changes.flatMap((change) =>
          completedEmails.has(change.email)
            ? []
            : (built.rowIdsByEmail.get(change.email) ?? []),
        );
        if (error.kind === "transient") {
          const transition = await dependencies.outbox.markTransient(
            remainingRowIds,
            runAt,
            error.code,
          );
          counts.retried += transition.retried;
          counts.parked += transition.parked;
        } else if (error.kind === "permission") {
          counts.retried += await dependencies.outbox.deferPermission(
            remainingRowIds,
            runAt,
            error.code,
          );
          permissionErrorCode = error.code;
        } else {
          counts.parked += await dependencies.outbox.markParked(
            remainingRowIds,
            "permanent",
            error.code,
          );
        }
      }
    }

    if (permissionErrorCode !== null) {
      logger.error(JSON.stringify({
        event: "salesforce.subscription_push.permission_error",
        code: permissionErrorCode,
      }));
      await dependencies.opsAlertSender.send({
        category: "salesforce_subscription_push_permission",
        dedupKey: "salesforce-subscription-push-permission",
        severity: "s2",
        summary: "Salesforce subscription push permission error",
        categoryLabel: "Salesforce subscription push",
        detail: [{ label: "Error code", value: permissionErrorCode }],
        links: [],
        firstObservedAt: runAt.toISOString(),
        occurredAt: runAt.toISOString(),
      });
    }

    const totals = await dependencies.outbox.countByStatus();
    logger.info(JSON.stringify({
      event: "salesforce.subscription_push.run",
      claimed: rows.length,
      emails: built.changes.length,
      created: counts.created,
      updated: counts.updated,
      retried: counts.retried,
      parked: counts.parked,
      skipped_no_box: built.skipped.length,
      pending_total: totals.pending,
      parked_total: totals.parked,
    }));
  };
}
