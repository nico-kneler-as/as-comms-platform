import { describe, expect, it } from "vitest";

import { canSendTo, type ConsentRecord } from "../src/index.js";

function consent(status: ConsentRecord["status"], createdAt: Date): ConsentRecord {
  return {
    id: `consent-${status}-${createdAt.toISOString()}`,
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

describe("canSendTo", () => {
  const optedInThenRevokedLatest = consent(
    "revoked",
    new Date("2026-04-02T00:00:00Z"),
  );

  it.each([
    [
      "no record and no inbound",
      null,
      false,
      { canSend: false, reason: "no_consent" },
    ],
    [
      "opted in",
      consent("opted_in", new Date("2026-04-01T00:00:00Z")),
      false,
      { canSend: true },
    ],
    [
      "revoked",
      consent("revoked", new Date("2026-04-02T00:00:00Z")),
      false,
      { canSend: false, reason: "revoked" },
    ],
    ["no record and inbound", null, true, { canSend: true }],
    [
      "latest record is revoked",
      optedInThenRevokedLatest,
      false,
      { canSend: false, reason: "revoked" },
    ],
  ])("%s", (_label, latestConsent, hasPriorInbound, expected) => {
    expect(canSendTo({ latestConsent, hasPriorInbound })).toEqual(expected);
  });
});
