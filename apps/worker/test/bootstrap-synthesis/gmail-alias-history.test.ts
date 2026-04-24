import { describe, expect, it } from "vitest";

import { digestAliasHistory } from "../../src/jobs/bootstrap-project-knowledge/fetchers/gmail-alias-history.js";
import { createTestWorkerContext } from "../helpers.js";

async function seedGmailEvent(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>,
  input: {
    readonly id: string;
    readonly direction: "inbound" | "outbound";
    readonly occurredAt: string;
    readonly body: string;
    readonly alias: string;
    readonly threadId: string;
  },
) {
  const sourceEvidenceId = `source:${input.id}`;
  const eventType =
    input.direction === "inbound"
      ? "communication.email.inbound"
      : "communication.email.outbound";

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.id,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/gmail/${input.id}.json`,
    idempotencyKey: `gmail:${input.id}`,
    checksum: `checksum:${input.id}`,
  });
  await context.repositories.contacts.upsert({
    id: `contact:${input.id}`,
    salesforceContactId: null,
    displayName: "Volunteer",
    primaryEmail: null,
    primaryPhone: null,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
  });
  await context.repositories.canonicalEvents.upsert({
    id: `event:${input.id}`,
    contactId: `contact:${input.id}`,
    eventType,
    channel: "email",
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.id}`,
    provenance: {
      primaryProvider: "gmail",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "message",
      sourceRecordId: input.id,
      messageKind: "one_to_one",
      campaignRef: null,
      threadRef: {
        providerThreadId: input.threadId,
        crossProviderCollapseKey: null,
      },
      direction: input.direction,
      notes: null,
    },
    reviewState: "clear",
  });
  await context.repositories.gmailMessageDetails.upsert({
    sourceEvidenceId,
    providerRecordId: input.id,
    gmailThreadId: input.threadId,
    rfc822MessageId: `<${input.id}@example.org>`,
    direction: input.direction,
    subject: "Training question",
    fromHeader:
      input.direction === "inbound"
        ? "Alice Volunteer <alice@example.org>"
        : input.alias,
    toHeader:
      input.direction === "inbound"
        ? input.alias
        : "Alice Volunteer <alice@example.org>",
    ccHeader: null,
    labelIds: ["INBOX"],
    snippetClean: input.body,
    bodyTextPreview: input.body,
    capturedMailbox: input.alias,
    projectInboxAlias: input.alias,
  });
}

describe("Gmail alias history digest", () => {
  it("builds masked Q/A digest from bounded project alias history", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedGmailEvent(context, {
        id: "inbound-1",
        direction: "inbound",
        occurredAt: "2026-03-01T12:00:00.000Z",
        body:
          "Hi, this is Alice Smith. Can you send the training link to alice@example.org or call 303-555-1212?",
        alias: "orcas@adventurescientists.org",
        threadId: "thread-1",
      });
      await seedGmailEvent(context, {
        id: "outbound-1",
        direction: "outbound",
        occurredAt: "2026-03-01T13:00:00.000Z",
        body:
          "Hi Alice Smith, please use the volunteer portal training module before the field day.",
        alias: "orcas@adventurescientists.org",
        threadId: "thread-1",
      });
      await seedGmailEvent(context, {
        id: "other-project",
        direction: "inbound",
        occurredAt: "2026-03-01T14:00:00.000Z",
        body: "This should not leak into the digest.",
        alias: "other@adventurescientists.org",
        threadId: "thread-2",
      });

      const result = await digestAliasHistory({
        db: context.db,
        projectAlias: "orcas@adventurescientists.org",
        now: new Date("2026-04-24T12:00:00.000Z"),
      });

      expect(result.threadCount).toBe(1);
      expect(result.digestMarkdown).toContain("Q:");
      expect(result.digestMarkdown).toContain("A:");
      expect(result.digestMarkdown).toContain("{NAME}");
      expect(result.digestMarkdown).toContain("{EMAIL}");
      expect(result.digestMarkdown).toContain("{PHONE}");
      expect(result.digestMarkdown).toContain("volunteer portal training module");
      expect(result.digestMarkdown).not.toContain("Alice Smith");
      expect(result.digestMarkdown).not.toContain("alice@example.org");
      expect(result.digestMarkdown).not.toContain("303-555-1212");
      expect(result.digestMarkdown).not.toContain("This should not leak");
    } finally {
      await context.dispose();
    }
  });

  it("excludes messages outside the configured lookback window", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedGmailEvent(context, {
        id: "old-inbound",
        direction: "inbound",
        occurredAt: "2023-01-01T12:00:00.000Z",
        body: "Old question",
        alias: "orcas@adventurescientists.org",
        threadId: "thread-old",
      });
      await seedGmailEvent(context, {
        id: "old-outbound",
        direction: "outbound",
        occurredAt: "2023-01-01T13:00:00.000Z",
        body: "Old answer",
        alias: "orcas@adventurescientists.org",
        threadId: "thread-old",
      });

      await expect(
        digestAliasHistory({
          db: context.db,
          projectAlias: "orcas@adventurescientists.org",
          now: new Date("2026-04-24T12:00:00.000Z"),
          monthsBack: 24,
        }),
      ).resolves.toEqual({
        digestMarkdown: "",
        threadCount: 0,
      });
    } finally {
      await context.dispose();
    }
  });
});
