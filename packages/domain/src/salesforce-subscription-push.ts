import {
  salesforceSubscriptionBoxValues,
  type SalesforceSubscriptionBox,
  type SalesforceSubscriptionOutboxRow,
  type SubscriptionPreferenceChange,
} from "@as-comms/contracts";

export type OutboxRow = SalesforceSubscriptionOutboxRow;

export function buildSubscriptionPreferenceChanges(input: {
  readonly rows: readonly OutboxRow[];
  readonly projectBoxes: ReadonlyMap<string, string>;
  readonly projectHosts: ReadonlyMap<string, string>;
  readonly salesforceContactIds: ReadonlyMap<string, string>;
}): {
  changes: SubscriptionPreferenceChange[];
  rowIdsByEmail: Map<string, string[]>;
  skipped: { rowId: string; reason: "no_box_for_project" }[];
} {
  const changesByEmail = new Map<string, SubscriptionPreferenceChange>();
  const rowIdsByEmail = new Map<string, string[]>();
  const skipped: { rowId: string; reason: "no_box_for_project" }[] = [];
  const rows = [...input.rows].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );

  for (const row of rows) {
    let change = changesByEmail.get(row.email) ?? { email: row.email };
    if (row.contactId !== null) {
      const salesforceContactId = input.salesforceContactIds.get(row.contactId);
      if (salesforceContactId !== undefined) {
        change = { ...change, contactId: salesforceContactId };
      }
    }

    switch (row.eventKind) {
      case "newsletter_opt_out":
        change = { ...change, generalNewsletter: false };
        break;
      case "newsletter_signup":
        change = { ...change, generalNewsletter: true };
        break;
      case "project_opt_out": {
        const projectId = row.projectId ?? "";
        const hostProjectId = input.projectHosts.get(projectId);
        const box =
          input.projectBoxes.get(projectId) ??
          (hostProjectId === undefined
            ? undefined
            : input.projectBoxes.get(hostProjectId));
        if (
          box === undefined ||
          !salesforceSubscriptionBoxValues.includes(
            box as SalesforceSubscriptionBox,
          )
        ) {
          skipped.push({ rowId: row.id, reason: "no_box_for_project" });
          continue;
        }
        change = {
          ...change,
          projectBoxes: {
            ...change.projectBoxes,
            [box]: false,
          },
        };
        break;
      }
      case "all_opt_out":
        change = {
          ...change,
          generalNewsletter: false,
          oregonShoresNewsletter: false,
          unsubscribedFromAll: true,
          unsubscribedAt: row.occurredAt,
          projectBoxes: Object.fromEntries(
            salesforceSubscriptionBoxValues.map((box) => [box, false]),
          ),
        } as SubscriptionPreferenceChange;
        break;
      case "hard_bounce":
        change = { ...change, emailBounced: true };
        break;
    }

    changesByEmail.set(row.email, change);
    const rowIds = rowIdsByEmail.get(row.email) ?? [];
    rowIds.push(row.id);
    rowIdsByEmail.set(row.email, rowIds);
  }

  return {
    changes: [...changesByEmail.values()],
    rowIdsByEmail,
    skipped,
  };
}
