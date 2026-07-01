import { describe, expect, it } from "vitest";

import {
  reconcileSmsConsent,
  type ConsentRecord,
  type SmsConsentReconcileAction,
} from "../src/index.js";

function consent(status: ConsentRecord["status"]): ConsentRecord {
  const createdAt =
    status === "opted_in"
      ? new Date("2026-07-01T12:00:00Z")
      : new Date("2026-07-02T12:00:00Z");

  return {
    id: `consent-${status}`,
    contactId: "contact-1",
    phoneE164: "+14065550142",
    status,
    source: "operator_attestation",
    sourceDetail: null,
    consentedAt: status === "opted_in" ? createdAt : null,
    revokedAt: status === "revoked" ? createdAt : null,
    recordedByUserId: "user-1",
    notes: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function applyAction(action: SmsConsentReconcileAction): ConsentRecord | null {
  if (action.kind === "none") {
    return null;
  }

  const createdAt =
    action.status === "opted_in"
      ? new Date("2026-07-03T12:00:00Z")
      : new Date("2026-07-04T12:00:00Z");

  return {
    id: `applied-${action.status}`,
    contactId: "contact-1",
    phoneE164: "+14065550142",
    status: action.status,
    source: action.source,
    sourceDetail: null,
    consentedAt: action.status === "opted_in" ? createdAt : null,
    revokedAt: action.status === "revoked" ? createdAt : null,
    recordedByUserId: null,
    notes: action.reason,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("reconcileSmsConsent", () => {
  it.each([
    [
      "appends opted_in when Salesforce is true and no latest consent exists",
      {
        sfTextOptIn: true,
        latestConsent: null,
      },
      {
        kind: "append",
        status: "opted_in",
        source: "salesforce_field",
        reason: "salesforce text opt-in enabled with no prior consent record",
      },
    ],
    [
      "returns none when Salesforce is true and latest consent is opted_in",
      {
        sfTextOptIn: true,
        latestConsent: consent("opted_in"),
      },
      { kind: "none" },
    ],
    [
      "returns none when Salesforce is true and latest consent is revoked",
      {
        sfTextOptIn: true,
        latestConsent: consent("revoked"),
      },
      { kind: "none" },
    ],
    [
      "appends revoked when Salesforce is false and latest consent is opted_in",
      {
        sfTextOptIn: false,
        latestConsent: consent("opted_in"),
      },
      {
        kind: "append",
        status: "revoked",
        source: "salesforce_field",
        reason:
          "salesforce text opt-in absent so latest opted-in consent must be revoked",
      },
    ],
    [
      "returns none when Salesforce is false and latest consent is revoked",
      {
        sfTextOptIn: false,
        latestConsent: consent("revoked"),
      },
      { kind: "none" },
    ],
    [
      "returns none when Salesforce is false and no latest consent exists",
      {
        sfTextOptIn: false,
        latestConsent: null,
      },
      { kind: "none" },
    ],
    [
      "appends revoked when Salesforce is null and latest consent is opted_in",
      {
        sfTextOptIn: null,
        latestConsent: consent("opted_in"),
      },
      {
        kind: "append",
        status: "revoked",
        source: "salesforce_field",
        reason:
          "salesforce text opt-in absent so latest opted-in consent must be revoked",
      },
    ],
    [
      "returns none when Salesforce is null and latest consent is revoked",
      {
        sfTextOptIn: null,
        latestConsent: consent("revoked"),
      },
      { kind: "none" },
    ],
    [
      "returns none when Salesforce is null and no latest consent exists",
      {
        sfTextOptIn: null,
        latestConsent: null,
      },
      { kind: "none" },
    ],
  ])("%s", (_label, input, expected) => {
    expect(reconcileSmsConsent(input)).toEqual(expected);
  });

  it("is idempotent after appending opted_in from a true Salesforce value", () => {
    const first = reconcileSmsConsent({
      sfTextOptIn: true,
      latestConsent: null,
    });

    expect(first).toMatchObject({
      kind: "append",
      status: "opted_in",
    });

    expect(
      reconcileSmsConsent({
        sfTextOptIn: true,
        latestConsent: applyAction(first),
      }),
    ).toEqual({ kind: "none" });
  });

  it("is idempotent after appending revoked from an absent Salesforce value", () => {
    const first = reconcileSmsConsent({
      sfTextOptIn: null,
      latestConsent: consent("opted_in"),
    });

    expect(first).toMatchObject({
      kind: "append",
      status: "revoked",
    });

    expect(
      reconcileSmsConsent({
        sfTextOptIn: null,
        latestConsent: applyAction(first),
      }),
    ).toEqual({ kind: "none" });
  });

  it("never re-subscribes a revoked contact from the Salesforce field alone", () => {
    expect(
      reconcileSmsConsent({
        sfTextOptIn: true,
        latestConsent: consent("revoked"),
      }),
    ).toEqual({ kind: "none" });
  });

  it("treats false and null Salesforce values identically", () => {
    const latestOptedIn = consent("opted_in");
    const latestRevoked = consent("revoked");

    expect(
      reconcileSmsConsent({
        sfTextOptIn: false,
        latestConsent: latestOptedIn,
      }),
    ).toEqual(
      reconcileSmsConsent({
        sfTextOptIn: null,
        latestConsent: latestOptedIn,
      }),
    );

    expect(
      reconcileSmsConsent({
        sfTextOptIn: false,
        latestConsent: latestRevoked,
      }),
    ).toEqual(
      reconcileSmsConsent({
        sfTextOptIn: null,
        latestConsent: latestRevoked,
      }),
    );

    expect(
      reconcileSmsConsent({
        sfTextOptIn: false,
        latestConsent: null,
      }),
    ).toEqual(
      reconcileSmsConsent({
        sfTextOptIn: null,
        latestConsent: null,
      }),
    );
  });
});
