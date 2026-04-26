import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

async function seedPendingOutboundFixture() {
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

  await context.repositories.contacts.upsert({
    id: "contact:pending-outbound",
    salesforceContactId: null,
    displayName: "Pending Outbound Contact",
    primaryEmail: "volunteer@example.org",
    primaryPhone: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  await context.repositories.projectDimensions.upsert({
    projectId: "project:antarctica",
    projectName: "Project Antarctica",
    source: "salesforce",
  });

  return context;
}

describe("pending composer outbound repositories", () => {
  it("inserts rows, finds by fingerprint, and returns timeline-visible statuses", async () => {
    const context = await seedPendingOutboundFixture();
    const sentAt = "2026-04-21T12:34:00.000Z";

    try {
      const id = await context.repositories.pendingOutbounds.insert({
        id: "pending:1",
        fingerprint: "fp:pending:1",
        actorId: "user:operator",
        canonicalContactId: "contact:pending-outbound",
        projectId: "project:antarctica",
        fromAlias: "antarctica@example.org",
        toEmailNormalized: "volunteer@example.org",
        subject: "Field update",
        bodyPlaintext: "We are all set for the field update.",
        bodySha256: "sha256:body:1",
        attachmentMetadata: [
          {
            filename: "checklist.pdf",
            size: 42_000,
            contentType: "application/pdf",
          },
        ],
        gmailThreadId: "thread:1",
        inReplyToRfc822: "<reply@example.org>",
        sentAt,
      });

      expect(id).toBe("pending:1");
      await expect(
        context.repositories.pendingOutbounds.findByFingerprint("fp:pending:1"),
      ).resolves.toMatchObject({
        id: "pending:1",
        status: "pending",
        bodyPlaintext: "We are all set for the field update.",
        attachmentMetadata: [
          {
            filename: "checklist.pdf",
            size: 42_000,
            contentType: "application/pdf",
          },
        ],
        sentAt,
        sentRfc822MessageId: null,
        failedDetail: null,
      });

      await context.repositories.pendingOutbounds.markFailed("pending:1", {
        reason: "provider_transient",
        detail: "Temporary provider failure",
      });
      await context.repositories.pendingOutbounds.markSentRfc822(
        "pending:1",
        "<pending-1@example.org>",
      );
      await context.repositories.pendingOutbounds.insert({
        id: "pending:2",
        fingerprint: "fp:pending:2",
        actorId: "user:operator",
        canonicalContactId: "contact:pending-outbound",
        projectId: null,
        fromAlias: "antarctica@example.org",
        toEmailNormalized: "volunteer@example.org",
        subject: "Superseded retry",
        bodyPlaintext: "Second attempt",
        bodySha256: "sha256:body:2",
        attachmentMetadata: [],
        gmailThreadId: null,
        inReplyToRfc822: null,
        sentAt: "2026-04-21T12:35:00.000Z",
      });
      await context.repositories.pendingOutbounds.markSuperseded("pending:2");
      await context.repositories.pendingOutbounds.insert({
        id: "pending:3",
        fingerprint: "fp:pending:3",
        actorId: "user:operator",
        canonicalContactId: "contact:pending-outbound",
        projectId: null,
        fromAlias: "antarctica@example.org",
        toEmailNormalized: "volunteer@example.org",
        subject: "Third attempt",
        bodyPlaintext: "Third attempt body",
        bodySha256: "sha256:body:3",
        attachmentMetadata: [],
        gmailThreadId: null,
        inReplyToRfc822: null,
        sentAt: "2026-04-21T12:36:00.000Z",
      });

      await expect(
        context.repositories.pendingOutbounds.findForContact(
          "contact:pending-outbound",
          { limit: 10 },
        ),
      ).resolves.toMatchObject([
        { id: "pending:3", status: "pending" },
        {
          id: "pending:1",
          status: "failed",
          failedReason: "provider_transient",
          failedDetail: "Temporary provider failure",
          sentRfc822MessageId: "<pending-1@example.org>",
        },
      ]);
      await expect(
        context.repositories.pendingOutbounds.findBySentRfc822MessageId(
          "<pending-1@example.org>",
        ),
      ).resolves.toMatchObject({
        id: "pending:1",
      });
    } finally {
      await context.client.close();
    }
  });

  it("confirms rows and sweeps only older pending rows into orphaned", async () => {
    const context = await seedPendingOutboundFixture();

    try {
      await context.repositories.pendingOutbounds.insert({
        id: "pending:confirm",
        fingerprint: "fp:confirm",
        actorId: "user:operator",
        canonicalContactId: "contact:pending-outbound",
        projectId: null,
        fromAlias: "antarctica@example.org",
        toEmailNormalized: "volunteer@example.org",
        subject: "Confirmed message",
        bodyPlaintext: "Confirmed body",
        bodySha256: "sha256:confirm",
        attachmentMetadata: [],
        gmailThreadId: null,
        inReplyToRfc822: null,
        sentAt: "2026-04-21T12:00:00.000Z",
      });
      await context.repositories.pendingOutbounds.insert({
        id: "pending:old",
        fingerprint: "fp:old",
        actorId: "user:operator",
        canonicalContactId: "contact:pending-outbound",
        projectId: null,
        fromAlias: "antarctica@example.org",
        toEmailNormalized: "volunteer@example.org",
        subject: "Old pending",
        bodyPlaintext: "Old body",
        bodySha256: "sha256:old",
        attachmentMetadata: [],
        gmailThreadId: null,
        inReplyToRfc822: null,
        sentAt: "2026-04-21T11:20:00.000Z",
      });
      await context.repositories.pendingOutbounds.insert({
        id: "pending:new",
        fingerprint: "fp:new",
        actorId: "user:operator",
        canonicalContactId: "contact:pending-outbound",
        projectId: null,
        fromAlias: "antarctica@example.org",
        toEmailNormalized: "volunteer@example.org",
        subject: "Fresh pending",
        bodyPlaintext: "Fresh body",
        bodySha256: "sha256:new",
        attachmentMetadata: [],
        gmailThreadId: null,
        inReplyToRfc822: null,
        sentAt: "2026-04-21T11:45:00.000Z",
      });

      await context.repositories.pendingOutbounds.markConfirmed("pending:confirm", {
        reconciledEventId: "event:confirmed",
      });

      expect(
        await context.repositories.pendingOutbounds.findByFingerprint("fp:confirm"),
      ).toMatchObject({
        id: "pending:confirm",
        status: "confirmed",
        reconciledEventId: "event:confirmed",
      });

      const swept = await context.repositories.pendingOutbounds.sweepOrphans({
        olderThan: new Date("2026-04-21T11:30:00.000Z"),
      });

      expect(swept).toBe(1);
      expect(
        await context.repositories.pendingOutbounds.findByFingerprint("fp:old"),
      ).toMatchObject({
        id: "pending:old",
        status: "orphaned",
      });
      expect(
        await context.repositories.pendingOutbounds.findByFingerprint("fp:new"),
      ).toMatchObject({
        id: "pending:new",
        status: "pending",
      });
    } finally {
      await context.client.close();
    }
  });
});
