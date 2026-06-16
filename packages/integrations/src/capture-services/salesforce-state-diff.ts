export interface SalesforceRowSnapshot {
  /** Salesforce record ID (e.g. `003VK00000mE06CYAS`). */
  readonly id: string;
  /** True if Salesforce returned this row with `IsDeleted = true`. */
  readonly isDeleted: boolean;
}

export interface SalesforceStateDiff {
  /** SF IDs that exist in both SF (non-deleted) and our DB. */
  readonly presentInBoth: readonly string[];
  /**
   * SF IDs we have locally where SF either returned `IsDeleted = true`
   * OR did not return the row at all. Both cases mean: tombstone our
   * row. (We can't distinguish "soft-deleted" from "purged from Recycle
   * Bin" cleanly enough to matter for reconciliation.)
   */
  readonly deletedInSalesforce: readonly string[];
  /**
   * SF IDs that exist in SF (non-deleted) but not in our DB. Logged
   * for visibility; Brick 2b doesn't act on these (re-ingest is a v2
   * concern).
   */
  readonly missingLocally: readonly string[];
}

export function diffSalesforceState(input: {
  readonly salesforceRows: readonly SalesforceRowSnapshot[];
  readonly databaseIds: readonly string[];
}): SalesforceStateDiff {
  const salesforceRowsById = new Map<string, boolean>();
  for (const row of input.salesforceRows) {
    salesforceRowsById.set(row.id, row.isDeleted);
  }

  const databaseIdSet = new Set(input.databaseIds);
  const presentInBoth: string[] = [];
  const deletedInSalesforce: string[] = [];

  for (const databaseId of databaseIdSet) {
    const salesforceDeleted = salesforceRowsById.get(databaseId);
    if (salesforceDeleted === false) {
      presentInBoth.push(databaseId);
      continue;
    }

    deletedInSalesforce.push(databaseId);
  }

  const missingLocally: string[] = [];
  for (const [salesforceId, isDeleted] of salesforceRowsById) {
    if (isDeleted || databaseIdSet.has(salesforceId)) {
      continue;
    }

    missingLocally.push(salesforceId);
  }

  presentInBoth.sort();
  deletedInSalesforce.sort();
  missingLocally.sort();

  return {
    presentInBoth,
    deletedInSalesforce,
    missingLocally,
  };
}
