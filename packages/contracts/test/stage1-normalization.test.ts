import { describe, expect, it } from "vitest";

import {
  identityAmbiguityInputSchema,
  normalizedCanonicalEventIntakeSchema,
  normalizedIdentityEvidenceSchema,
  normalizedRoutingContextSchema
} from "../src/index.js";

describe("Stage 1 normalization contracts", () => {
  it("requires at least one identity signal", () => {
    const result = normalizedIdentityEvidenceSchema.safeParse({
      salesforceContactId: null,
      volunteerIdPlainValues: [],
      normalizedEmails: [],
      normalizedPhones: []
    });

    expect(result.success).toBe(false);
  });

  it("keeps canonical event intake provider-agnostic and source-evidence centered", () => {
    const result = normalizedCanonicalEventIntakeSchema.safeParse({
      sourceEvidence: {
        id: "sev_1",
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "gmail-message-1",
        receivedAt: "2026-01-01T00:01:00.000Z",
        occurredAt: "2026-01-01T00:00:00.000Z",
        payloadRef: "payloads/gmail/gmail-message-1.json",
        idempotencyKey: "gmail:message:gmail-message-1",
        checksum: "checksum-1"
      },
      canonicalEvent: {
        id: "evt_1",
        eventType: "communication.email.inbound",
        occurredAt: "2026-01-01T00:00:00.000Z",
        idempotencyKey: "canonical:gmail-message-1",
        summary: "Inbound email received",
        snippet: "Hello from Gmail"
      },
      identity: {
        normalizedEmails: ["volunteer@example.org"]
      },
      routing: {
        required: true,
        projectId: "project_1",
        expeditionId: null
      },
      supportingSources: [
        {
          provider: "salesforce",
          sourceEvidenceId: "sev_2"
        }
      ]
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceEvidence.providerRecordType).toBe("message");
      expect(result.data.canonicalEvent.eventType).toBe(
        "communication.email.inbound"
      );
    }
  });

  it("rejects canonical event intake that repeats the primary source evidence", () => {
    const result = normalizedCanonicalEventIntakeSchema.safeParse({
      sourceEvidence: {
        id: "sev_1",
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "gmail-message-1",
        receivedAt: "2026-01-01T00:01:00.000Z",
        occurredAt: "2026-01-01T00:00:00.000Z",
        payloadRef: "payloads/gmail/gmail-message-1.json",
        idempotencyKey: "gmail:message:gmail-message-1",
        checksum: "checksum-1"
      },
      canonicalEvent: {
        id: "evt_1",
        eventType: "communication.email.outbound",
        occurredAt: "2026-01-01T00:00:00.000Z",
        idempotencyKey: "canonical:gmail-message-1",
        summary: "Outbound email sent"
      },
      identity: {
        normalizedEmails: ["volunteer@example.org"]
      },
      supportingSources: [
        {
          provider: "salesforce",
          sourceEvidenceId: "sev_1"
        }
      ]
    });

    expect(result.success).toBe(false);
  });

  it("accepts review-case DTOs with explicit status and timestamps", () => {
    const routing = normalizedRoutingContextSchema.parse({
      required: true,
      projectId: "project_1",
      expeditionId: "expedition_1"
    });

    const identityCase = identityAmbiguityInputSchema.parse({
      sourceEvidenceId: "sev_1",
      candidateContactIds: ["contact_1", "contact_2"],
      reasonCode: "identity_multi_candidate",
      status: "open",
      openedAt: "2026-01-01T00:00:00.000Z",
      resolvedAt: null,
      normalizedIdentityValues: ["volunteer@example.org"],
      anchoredContactId: null,
      explanation: "Multiple contacts share the same normalized email."
    });

    expect(routing.required).toBe(true);
    expect(identityCase.reasonCode).toBe("identity_multi_candidate");
  });
});
