import type {
  ResidenceStateCode,
  SalesforceContactStateRow,
} from "@as-comms/contracts";

import { normalizeEmailAddress } from "./normalization.js";
import { normalizeStateOfResidence } from "./residence-state.js";

export interface SalesforceContactStateRecord {
  readonly normalizedEmail: string;
  readonly stateCode: ResidenceStateCode | null;
  readonly rawState: string;
  readonly salesforceContactId: string;
  readonly salesforceLastModifiedAt: Date;
}

export interface SalesforceContactStateRowBuildStats {
  readonly inputRows: number;
  readonly droppedInvalidEmail: number;
  readonly duplicatesCollapsed: number;
  readonly withStateCode: number;
  readonly withoutStateCode: number;
}

export interface SalesforceContactStateRowBuildResult {
  readonly records: readonly SalesforceContactStateRecord[];
  readonly stats: SalesforceContactStateRowBuildStats;
}

function isPreferred(
  candidate: SalesforceContactStateRecord,
  current: SalesforceContactStateRecord,
): boolean {
  const candidateTime = candidate.salesforceLastModifiedAt.getTime();
  const currentTime = current.salesforceLastModifiedAt.getTime();
  return candidateTime > currentTime || (
    candidateTime === currentTime &&
    candidate.salesforceContactId.localeCompare(current.salesforceContactId) < 0
  );
}

export function buildSalesforceContactStateRows(
  rows: readonly SalesforceContactStateRow[],
): SalesforceContactStateRowBuildResult {
  const recordsByEmail = new Map<string, SalesforceContactStateRecord>();
  let droppedInvalidEmail = 0;
  let duplicatesCollapsed = 0;

  for (const row of rows) {
    const normalizedEmail = normalizeEmailAddress(row.email);
    if (normalizedEmail === null) {
      droppedInvalidEmail += 1;
      continue;
    }

    const record: SalesforceContactStateRecord = {
      normalizedEmail,
      stateCode: normalizeStateOfResidence(row.rawState),
      rawState: row.rawState.trim(),
      salesforceContactId: row.salesforceContactId,
      salesforceLastModifiedAt: new Date(row.lastModifiedAt),
    };
    const existing = recordsByEmail.get(normalizedEmail);
    if (existing !== undefined) {
      duplicatesCollapsed += 1;
      if (!isPreferred(record, existing)) continue;
    }
    recordsByEmail.set(normalizedEmail, record);
  }

  const records = [...recordsByEmail.values()].sort((left, right) =>
    left.normalizedEmail.localeCompare(right.normalizedEmail),
  );
  const withStateCode = records.filter((record) => record.stateCode !== null).length;

  return {
    records,
    stats: {
      inputRows: rows.length,
      droppedInvalidEmail,
      duplicatesCollapsed,
      withStateCode,
      withoutStateCode: records.length - withStateCode,
    },
  };
}
