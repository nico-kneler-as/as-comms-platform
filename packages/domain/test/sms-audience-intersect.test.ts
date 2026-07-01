import { describe, expect, it } from "vitest";

import {
  intersectSmsAudience,
  type ConsentStatus,
  type SmsAudienceCandidate,
} from "../src/index.js";

function candidate(
  overrides: Partial<SmsAudienceCandidate> & Pick<SmsAudienceCandidate, "contactId">,
): SmsAudienceCandidate {
  return {
    phoneE164: "+14065550142",
    firstName: "Ada",
    email: "ada@example.com",
    projectName: "Project Atlas",
    ...overrides,
  };
}

function consentMap(
  entries: readonly (readonly [string, ConsentStatus | null])[],
): ReadonlyMap<string, ConsentStatus | null> {
  return new Map(entries);
}

describe("intersectSmsAudience", () => {
  it.each([
    [
      "includes opted-in candidates with a phone as reachable recipients",
      {
        candidates: [
          candidate({
            contactId: "contact-1",
            phoneE164: "+14065550142",
            firstName: "Ada",
            email: "ada@example.com",
            projectName: "Project Atlas",
          }),
        ],
        latestConsentByContactId: consentMap([["contact-1", "opted_in"]]),
      },
      {
        reachable: [
          {
            contactId: "contact-1",
            phoneE164: "+14065550142",
            firstName: "Ada",
            email: "ada@example.com",
            projectName: "Project Atlas",
          },
        ],
        selectedCount: 1,
        reachableCount: 1,
        unreachable: {
          no_consent: 0,
          revoked: 0,
          no_phone: 0,
        },
      },
    ],
    [
      "counts opted-in candidates without a phone as no_phone when phone is null",
      {
        candidates: [candidate({ contactId: "contact-1", phoneE164: null })],
        latestConsentByContactId: consentMap([["contact-1", "opted_in"]]),
      },
      {
        reachable: [],
        selectedCount: 1,
        reachableCount: 0,
        unreachable: {
          no_consent: 0,
          revoked: 0,
          no_phone: 1,
        },
      },
    ],
    [
      "counts opted-in candidates without a phone as no_phone when phone is empty",
      {
        candidates: [candidate({ contactId: "contact-1", phoneE164: "" })],
        latestConsentByContactId: consentMap([["contact-1", "opted_in"]]),
      },
      {
        reachable: [],
        selectedCount: 1,
        reachableCount: 0,
        unreachable: {
          no_consent: 0,
          revoked: 0,
          no_phone: 1,
        },
      },
    ],
    [
      "counts revoked contacts as revoked even when a phone is present",
      {
        candidates: [candidate({ contactId: "contact-1" })],
        latestConsentByContactId: consentMap([["contact-1", "revoked"]]),
      },
      {
        reachable: [],
        selectedCount: 1,
        reachableCount: 0,
        unreachable: {
          no_consent: 0,
          revoked: 1,
          no_phone: 0,
        },
      },
    ],
    [
      "counts contacts missing consent from the map as no_consent",
      {
        candidates: [candidate({ contactId: "contact-1" })],
        latestConsentByContactId: consentMap([]),
      },
      {
        reachable: [],
        selectedCount: 1,
        reachableCount: 0,
        unreachable: {
          no_consent: 1,
          revoked: 0,
          no_phone: 0,
        },
      },
    ],
    [
      "gives consent precedence over phone when a revoked contact has no phone",
      {
        candidates: [candidate({ contactId: "contact-1", phoneE164: null })],
        latestConsentByContactId: consentMap([["contact-1", "revoked"]]),
      },
      {
        reachable: [],
        selectedCount: 1,
        reachableCount: 0,
        unreachable: {
          no_consent: 0,
          revoked: 1,
          no_phone: 0,
        },
      },
    ],
    [
      "returns zero counts for an empty candidate list",
      {
        candidates: [],
        latestConsentByContactId: consentMap([]),
      },
      {
        reachable: [],
        selectedCount: 0,
        reachableCount: 0,
        unreachable: {
          no_consent: 0,
          revoked: 0,
          no_phone: 0,
        },
      },
    ],
  ])("%s", (_label, input, expected) => {
    expect(intersectSmsAudience(input)).toEqual(expected);
  });

  it("partitions a mixed batch into reachable and unreachable buckets with correct counts", () => {
    const result = intersectSmsAudience({
      candidates: [
        candidate({ contactId: "contact-1", phoneE164: "+14065550101" }),
        candidate({ contactId: "contact-2", phoneE164: null }),
        candidate({ contactId: "contact-3", phoneE164: "+14065550103" }),
        candidate({ contactId: "contact-4", phoneE164: "+14065550104" }),
        candidate({ contactId: "contact-5", phoneE164: "" }),
        candidate({ contactId: "contact-6", phoneE164: null }),
      ],
      latestConsentByContactId: consentMap([
        ["contact-1", "opted_in"],
        ["contact-2", "opted_in"],
        ["contact-3", "revoked"],
        ["contact-5", "opted_in"],
        ["contact-6", null],
      ]),
    });

    expect(result).toEqual({
      reachable: [
        {
          contactId: "contact-1",
          phoneE164: "+14065550101",
          firstName: "Ada",
          email: "ada@example.com",
          projectName: "Project Atlas",
        },
      ],
      selectedCount: 6,
      reachableCount: 1,
      unreachable: {
        no_consent: 2,
        revoked: 1,
        no_phone: 2,
      },
    });

    expect(
      result.reachableCount +
        result.unreachable.no_consent +
        result.unreachable.revoked +
        result.unreachable.no_phone,
    ).toBe(result.selectedCount);
  });

  it("preserves reachable recipient order from the input candidates", () => {
    const result = intersectSmsAudience({
      candidates: [
        candidate({ contactId: "contact-1", phoneE164: "+14065550101" }),
        candidate({ contactId: "contact-2", phoneE164: null }),
        candidate({ contactId: "contact-3", phoneE164: "+14065550103" }),
        candidate({ contactId: "contact-4", phoneE164: "+14065550104" }),
      ],
      latestConsentByContactId: consentMap([
        ["contact-1", "opted_in"],
        ["contact-2", "opted_in"],
        ["contact-3", "revoked"],
        ["contact-4", "opted_in"],
      ]),
    });

    expect(result.reachable).toEqual([
      {
        contactId: "contact-1",
        phoneE164: "+14065550101",
        firstName: "Ada",
        email: "ada@example.com",
        projectName: "Project Atlas",
      },
      {
        contactId: "contact-4",
        phoneE164: "+14065550104",
        firstName: "Ada",
        email: "ada@example.com",
        projectName: "Project Atlas",
      },
    ]);
  });
});
