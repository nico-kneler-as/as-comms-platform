import type { ConsentStatus } from "./records.js";

export interface SmsAudienceCandidate {
  readonly contactId: string;
  readonly phoneE164: string | null;
  readonly firstName: string | null;
  readonly email: string | null;
  readonly projectName: string | null;
}

export interface SmsAudienceRecipient {
  readonly contactId: string;
  readonly phoneE164: string;
  readonly firstName: string | null;
  readonly email: string | null;
  readonly projectName: string | null;
}

export type SmsUnreachableReason = "no_consent" | "revoked" | "no_phone";

export interface SmsAudienceIntersection {
  readonly reachable: readonly SmsAudienceRecipient[];
  readonly selectedCount: number;
  readonly reachableCount: number;
  readonly unreachable: Readonly<Record<SmsUnreachableReason, number>>;
}

/**
 * Intersects already-resolved audience candidates with latest SMS consent and phone presence.
 *
 * Preconditions:
 * - `candidates` are already de-duplicated by `contactId`.
 * - This function does not deduplicate because doing so would hide an upstream resolver bug.
 */
export function intersectSmsAudience(input: {
  readonly candidates: readonly SmsAudienceCandidate[];
  readonly latestConsentByContactId: ReadonlyMap<string, ConsentStatus | null>;
}): SmsAudienceIntersection {
  const reachable: SmsAudienceRecipient[] = [];
  const unreachable: Record<SmsUnreachableReason, number> = {
    no_consent: 0,
    revoked: 0,
    no_phone: 0,
  };

  for (const candidate of input.candidates) {
    const status =
      input.latestConsentByContactId.get(candidate.contactId) ?? null;

    if (status !== "opted_in") {
      unreachable[status === "revoked" ? "revoked" : "no_consent"] += 1;
      continue;
    }

    if (candidate.phoneE164 === null || candidate.phoneE164 === "") {
      unreachable.no_phone += 1;
      continue;
    }

    reachable.push({
      contactId: candidate.contactId,
      phoneE164: candidate.phoneE164,
      firstName: candidate.firstName,
      email: candidate.email,
      projectName: candidate.projectName,
    });
  }

  return {
    reachable,
    selectedCount: input.candidates.length,
    reachableCount: reachable.length,
    unreachable,
  };
}
