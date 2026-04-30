import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestStage1Context } from "@as-comms/db/test-helpers";
import { computePendingComposerOutboundFingerprint } from "@as-comms/domain";
import { mapGmailRecord } from "../src/index.js";

async function seedContactFixture() {
  const context = await createTestStage1Context();
  const now = new Date("2026-04-21T12:00:00.000Z");

  await context.settings.users.upsert({
    id: "user:operator",
    name: "Operator",
    email: "operator@example.org",
    emailVerified: now,
    image: null,
    role: "operator",
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: "contact:email:volunteer@example.org",
      salesforceContactId: null,
      displayName: "Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    identities: [
      {
        id: "identity:volunteer:email",
        contactId: "contact:email:volunteer@example.org",
        kind: "email",
        normalizedValue: "volunteer@example.org",
        isPrimary: true,
        source: "manual",
        verifiedAt: now.toISOString(),
      },
    ],
    memberships: [],
  });

  return context;
}

function buildOutboundGmailRecord(input: {
  readonly recordId: string;
  readonly occurredAt: string;
  readonly subject: string;
  readonly bodyTextPreview: string;
}) {
  return {
    recordType: "message" as const,
    recordId: input.recordId,
    direction: "outbound" as const,
    occurredAt: input.occurredAt,
    receivedAt: input.occurredAt,
    payloadRef: `payloads/gmail/${input.recordId}.json`,
    checksum: `checksum:${input.recordId}`,
    snippet: input.bodyTextPreview,
    subject: input.subject,
    snippetClean: input.bodyTextPreview,
    bodyTextPreview: input.bodyTextPreview,
    threadId: `thread:${input.recordId}`,
    rfc822MessageId: `<${input.recordId}@example.org>`,
    capturedMailbox: "volunteers@example.org",
    projectInboxAlias: "antarctica@example.org",
    normalizedParticipantEmails: ["volunteer@example.org"],
    salesforceContactId: null,
    volunteerIdPlainValues: [],
    normalizedPhones: [],
    supportingRecords: [],
    crossProviderCollapseKey: null,
  };
}

describe("Gmail outbound reconciliation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("confirms a matching pending composer row when Gmail poll ingests the outbound", async () => {
    const context = await seedContactFixture();
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const subject = "Field logistics";
    const bodyTextPreview = "Thanks again for confirming the field logistics.";
    const occurredAt = "2026-04-21T12:34:20.000Z";
    const fingerprint = computePendingComposerOutboundFingerprint({
      contactId: "contact:email:volunteer@example.org",
      subject,
      bodyPlaintext: bodyTextPreview,
      sentAt: "2026-04-21T12:34:01.000Z",
    });

    if (fingerprint === null) {
      throw new Error("Expected fingerprint for pending outbound.");
    }

    try {
      await context.repositories.pendingOutbounds.insert({
        id: "pending:1",
        fingerprint,
        actorId: "user:operator",
        canonicalContactId: "contact:email:volunteer@example.org",
        projectId: null,
        fromAlias: "antarctica@example.org",
        toEmailNormalized: "volunteer@example.org",
        subject,
        bodyPlaintext: bodyTextPreview,
        bodySha256: "sha256:pending",
        attachmentMetadata: [],
        gmailThreadId: null,
        inReplyToRfc822: null,
        attemptedAt: "2026-04-21T12:34:01.000Z",
      });

      const mapped = mapGmailRecord(
        buildOutboundGmailRecord({
          recordId: "gmail-message-1",
          occurredAt,
          subject,
          bodyTextPreview,
        })
      );

      if (mapped.outcome !== "command" || mapped.command.kind !== "canonical_event") {
        throw new Error("Expected Gmail record to map to canonical event input.");
      }

      const result = await context.normalization.applyNormalizedCanonicalEvent(
        mapped.command.input
      );

      expect(result.outcome).toBe("applied");
      if (result.outcome !== "applied" && result.outcome !== "duplicate") {
        throw new Error("Expected canonical Gmail normalization result.");
      }

      expect(
        await context.repositories.pendingOutbounds.findByFingerprint(fingerprint)
      ).toMatchObject({
        id: "pending:1",
        status: "confirmed",
        reconciledEventId: result.canonicalEvent.id,
      });
      expect(consoleLog).toHaveBeenCalledWith(
        expect.stringContaining("\"event\":\"composer.reconciliation.matched\"")
      );
    } finally {
      await context.client.close();
    }
  });

  it("still writes the Gmail canonical event when no pending composer row matches", async () => {
    const context = await seedContactFixture();
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    try {
      const mapped = mapGmailRecord(
        buildOutboundGmailRecord({
          recordId: "gmail-message-2",
          occurredAt: "2026-04-21T12:40:20.000Z",
          subject: "Fresh outbound",
          bodyTextPreview: "Fresh outbound body",
        })
      );

      if (mapped.outcome !== "command" || mapped.command.kind !== "canonical_event") {
        throw new Error("Expected Gmail record to map to canonical event input.");
      }

      const result = await context.normalization.applyNormalizedCanonicalEvent(
        mapped.command.input
      );

      expect(result.outcome).toBe("applied");
      await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(1);
      expect(consoleLog).toHaveBeenCalledWith(
        expect.stringContaining("\"event\":\"composer.reconciliation.unmatched\"")
      );
    } finally {
      await context.client.close();
    }
  });
});
