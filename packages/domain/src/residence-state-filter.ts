import type { ResidenceStateCode } from "@as-comms/contracts";

import { normalizeEmailAddress } from "./normalization.js";

/** An email-keyed state snapshot. `ReadonlyMap` satisfies this interface. */
export interface ResidenceStateLookup {
  get(normalizedEmail: string): ResidenceStateCode | null | undefined;
}

export interface ResidenceStateFilterResult<T> {
  readonly members: readonly T[];
  readonly excludedNoStateOnFile: number;
  readonly excludedOtherState: number;
}

/**
 * Narrows an audience by state while retaining its original order.
 *
 * State snapshots are keyed by normalized email, so duplicate resolved members
 * are considered only once when a filter is active. An empty state selection
 * intentionally leaves the audience completely untouched.
 */
export function filterAudienceByResidenceState<
  T extends { readonly frozenEmail: string },
>(input: {
  readonly members: readonly T[];
  readonly states: readonly ResidenceStateCode[];
  readonly lookup: ResidenceStateLookup;
}): ResidenceStateFilterResult<T> {
  if (input.states.length === 0) {
    return {
      members: input.members,
      excludedNoStateOnFile: 0,
      excludedOtherState: 0,
    };
  }

  const selectedStates = new Set(input.states);
  const seenEmails = new Set<string>();
  const members: T[] = [];
  let excludedNoStateOnFile = 0;
  let excludedOtherState = 0;

  for (const member of input.members) {
    const normalizedEmail = normalizeEmailAddress(member.frozenEmail);
    if (normalizedEmail === null) {
      excludedNoStateOnFile += 1;
      continue;
    }
    if (seenEmails.has(normalizedEmail)) {
      continue;
    }
    seenEmails.add(normalizedEmail);

    const state = input.lookup.get(normalizedEmail);
    if (state == null) {
      excludedNoStateOnFile += 1;
      continue;
    }
    if (!selectedStates.has(state)) {
      excludedOtherState += 1;
      continue;
    }
    members.push(member);
  }

  return { members, excludedNoStateOnFile, excludedOtherState };
}

export interface ResidenceStateSummary {
  readonly byState: readonly {
    readonly code: ResidenceStateCode;
    readonly count: number;
  }[];
  readonly noStateOnFile: number;
  readonly total: number;
}

/** Summarizes the state snapshot coverage for a resolved base audience. */
// The generic accepts any audience member subtype while the aggregate result
// intentionally contains no member values.
export function summarizeResidenceStates<
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  T extends { readonly frozenEmail: string },
>(input: {
  readonly members: readonly T[];
  readonly lookup: ResidenceStateLookup;
}): ResidenceStateSummary {
  const counts = new Map<ResidenceStateCode, number>();
  const seenEmails = new Set<string>();
  let noStateOnFile = 0;

  for (const member of input.members) {
    const normalizedEmail = normalizeEmailAddress(member.frozenEmail);
    if (normalizedEmail === null) {
      noStateOnFile += 1;
      continue;
    }
    if (seenEmails.has(normalizedEmail)) {
      continue;
    }
    seenEmails.add(normalizedEmail);

    const state = input.lookup.get(normalizedEmail);
    if (state == null) {
      noStateOnFile += 1;
      continue;
    }
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }

  return {
    byState: [...counts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code)),
    noStateOnFile,
    total: input.members.length,
  };
}
