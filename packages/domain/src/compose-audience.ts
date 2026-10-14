import type { AudienceMember } from "./campaign-types.js";
import { normalizeEmailAddress } from "./normalization.js";

export interface AudienceCompositionExclusion {
  readonly reason: string;
  readonly emails: ReadonlySet<string>;
}

export interface ComposeAudienceInput {
  readonly base: readonly AudienceMember[];
  readonly includeEmails: ReadonlySet<string> | null;
  readonly exclusions: readonly AudienceCompositionExclusion[];
}

export interface ComposedAudience {
  readonly members: readonly AudienceMember[];
  readonly excludedByReason: Readonly<Record<string, number>>;
}

function normalizedSet(values: ReadonlySet<string>): ReadonlySet<string> {
  const result = new Set<string>();
  for (const value of values) {
    const normalized = normalizeEmailAddress(value);
    if (normalized !== null) {
      result.add(normalized);
    }
  }
  return result;
}

/** Applies list inclusion and exclusions to an already-resolved audience. */
export function composeAudience(input: ComposeAudienceInput): ComposedAudience {
  const includeEmails =
    input.includeEmails === null ? null : normalizedSet(input.includeEmails);
  const exclusions = input.exclusions.map((exclusion) => ({
    reason: exclusion.reason,
    emails: normalizedSet(exclusion.emails),
  }));
  const members: AudienceMember[] = [];
  const excludedByReason: Record<string, number> = {};
  const seen = new Set<string>();

  for (const member of input.base) {
    const email = normalizeEmailAddress(member.frozenEmail);
    if (email === null || seen.has(email)) {
      continue;
    }
    seen.add(email);
    if (includeEmails !== null && !includeEmails.has(email)) {
      continue;
    }

    const exclusion = exclusions.find((candidate) => candidate.emails.has(email));
    if (exclusion !== undefined) {
      excludedByReason[exclusion.reason] =
        (excludedByReason[exclusion.reason] ?? 0) + 1;
      continue;
    }
    members.push(member);
  }

  return { members, excludedByReason };
}
