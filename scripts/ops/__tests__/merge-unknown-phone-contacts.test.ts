import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  canonicalEventLedger,
  consentRecords,
  contactIdentities,
  contactInboxProjection,
  contacts,
  smsMessages,
  smsSenders,
} from "@as-comms/db";
import { createTestStage1Context } from "@as-comms/db/test-helpers";

import {
  mergeUnknownPhoneContacts,
  renderMergeUnknownPhoneContactsMarkdown,
} from "../merge-unknown-phone-contacts.js";

async function seedContact(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
  input: {
    readonly id: string;
    readonly displayName: string;
    readonly primaryPhone: string | null;
  },
): Promise<void> {
  await context.repositories.contacts.upsert({
    id: input.id,
    salesforceContactId: null,
    displayName: input.displayName,
    primaryEmail: null,
    primaryPhone: input.primaryPhone,
    createdAt: "2026-06-23T12:00:00.000Z",
    updatedAt: "2026-06-23T12:00:00.000Z",
  });
}

async function seedCanonicalEvent(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
  input: {
    readonly eventId: string;
    readonly contactId: string;
    readonly sourceEvidenceId: string;
  },
): Promise<void> {
  await context.repositories.sourceEvidence.append({
    id: input.sourceEvidenceId,
    provider: "twilio",
    providerRecordType: "message",
    providerRecordId: input.eventId,
    receivedAt: "2026-06-23T12:00:00.000Z",
    occurredAt: "2026-06-23T12:00:00.000Z",
    payloadRef: `payloads/twilio/${input.eventId}.json`,
    idempotencyKey: `twilio:${input.eventId}`,
    checksum: `checksum:${input.eventId}`,
  });
  await context.repositories.canonicalEvents.upsert({
    id: input.eventId,
    contactId: input.contactId,
    eventType: "communication.sms.inbound",
    channel: "sms",
    occurredAt: "2026-06-23T12:00:00.000Z",
    contentFingerprint: null,
    sourceEvidenceId: input.sourceEvidenceId,
    idempotencyKey: `canonical:${input.eventId}`,
    provenance: {
      primaryProvider: "twilio",
      primarySourceEvidenceId: input.sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "message",
      sourceRecordId: input.eventId,
      messageKind: "one_to_one",
      campaignRef: null,
      threadRef: {
        crossProviderCollapseKey: "+17743680124",
        providerThreadId: "+17743680124",
      },
      direction: "inbound",
      notes: null,
      inboxProjectionExclusionReason: null,
    },
    reviewState: "clear",
  });
}

describe("merge-unknown-phone-contacts", () => {
  it("merges an unknown contact into a single real-contact phone match", async () => {
    const context = await createTestStage1Context();

    try {
      await seedContact(context, {
        id: "contact-real",
        displayName: "Samantha Smith",
        primaryPhone: null,
      });
      await context.db.insert(contactIdentities).values({
        id: "identity-real-phone",
        contactId: "contact-real",
        kind: "phone",
        normalizedValue: "+17743680124",
        isPrimary: true,
        source: "salesforce",
        verifiedAt: null,
      });
      await seedContact(context, {
        id: "contact-unknown",
        displayName: "Unknown (+1 774 368 0124)",
        primaryPhone: "+17743680124",
      });
      await seedCanonicalEvent(context, {
        eventId: "event-unknown",
        contactId: "contact-unknown",
        sourceEvidenceId: "source-unknown",
      });
      await context.db.insert(smsSenders).values({
        id: "sender-1",
        phoneE164: "+14065550142",
        displayName: "Adventure Scientists",
        monthlyCap: null,
        isActive: true,
      });
      await context.repositories.smsMessages.insert({
        id: "sms-unknown",
        twilioMessageSid: "SM123",
        direction: "inbound",
        contactId: "contact-unknown",
        phoneE164: "+17743680124",
        senderId: "sender-1",
        body: "hello",
        segments: 1,
        encoding: "GSM-7",
        mediaUrls: null,
        sendStatus: "received",
        failedReason: null,
        failedDetail: null,
        sentAt: null,
        receivedAt: new Date("2026-06-23T12:00:00.000Z"),
        actorId: null,
        createdAt: new Date("2026-06-23T12:00:00.000Z"),
        updatedAt: new Date("2026-06-23T12:00:00.000Z"),
      });
      await context.repositories.consentRecords.insert({
        id: "consent-unknown",
        contactId: "contact-unknown",
        phoneE164: "+17743680124",
        status: "opted_in",
        source: "inbound_thread",
        sourceDetail: null,
        consentedAt: new Date("2026-06-23T12:00:00.000Z"),
        revokedAt: null,
        recordedByUserId: null,
        notes: null,
        createdAt: new Date("2026-06-23T12:00:00.000Z"),
        updatedAt: new Date("2026-06-23T12:00:00.000Z"),
      });
      await context.repositories.inboxProjection.upsert({
        contactId: "contact-unknown",
        bucket: "New",
        needsFollowUp: false,
        hasUnresolved: false,
        lastInboundAt: "2026-06-23T12:00:00.000Z",
        lastOutboundAt: null,
        lastActivityAt: "2026-06-23T12:00:00.000Z",
        snippet: "hello",
        archivedAt: null,
        lastCanonicalEventId: "event-unknown",
        lastEventType: "communication.sms.inbound",
      });

      const result = await mergeUnknownPhoneContacts({
        dryRun: false,
        db: context.db,
        repositories: context.repositories,
      });

      expect(result.merged).toBe(1);
      expect(result.skippedNoMatch).toBe(0);
      expect(result.skippedMultipleMatches).toBe(0);
      expect(result.actions[0]).toMatchObject({
        status: "merged",
        unknownContactId: "contact-unknown",
        mergedIntoContactId: "contact-real",
        smsMessagesReattached: 1,
        canonicalEventsReattached: 1,
        consentRecordsReattached: 1,
      });

      await expect(
        context.repositories.contacts.findById("contact-unknown"),
      ).resolves.toBeNull();
      await expect(
        context.repositories.contacts.findById("contact-real"),
      ).resolves.toMatchObject({ id: "contact-real" });

      const smsRows = await context.db
        .select()
        .from(smsMessages)
        .where(eq(smsMessages.id, "sms-unknown"));
      expect(smsRows[0]?.contactId).toBe("contact-real");

      const eventRows = await context.db
        .select()
        .from(canonicalEventLedger)
        .where(eq(canonicalEventLedger.id, "event-unknown"));
      expect(eventRows[0]?.contactId).toBe("contact-real");

      const consentRows = await context.db
        .select()
        .from(consentRecords)
        .where(eq(consentRecords.id, "consent-unknown"));
      expect(consentRows[0]?.contactId).toBe("contact-real");

      const identityRows = await context.db
        .select()
        .from(contactIdentities)
        .where(eq(contactIdentities.contactId, "contact-unknown"));
      expect(identityRows).toHaveLength(0);

      const projectionRows = await context.db
        .select()
        .from(contactInboxProjection)
        .where(eq(contactInboxProjection.contactId, "contact-real"));
      expect(projectionRows).toHaveLength(1);
    } finally {
      await context.dispose();
    }
  });

  it("leaves an orphan unknown contact alone when no real-contact match exists", async () => {
    const context = await createTestStage1Context();

    try {
      await seedContact(context, {
        id: "contact-orphan",
        displayName: "Unknown (+1 406 555 0199)",
        primaryPhone: "+14065550199",
      });

      const result = await mergeUnknownPhoneContacts({
        dryRun: false,
        db: context.db,
        repositories: context.repositories,
      });

      expect(result.merged).toBe(0);
      expect(result.skippedNoMatch).toBe(1);
      await expect(
        context.repositories.contacts.findById("contact-orphan"),
      ).resolves.toMatchObject({ id: "contact-orphan" });
    } finally {
      await context.dispose();
    }
  });

  it("skips unknown contacts with multiple real-contact matches", async () => {
    const context = await createTestStage1Context();

    try {
      await seedContact(context, {
        id: "contact-real-a",
        displayName: "Real A",
        primaryPhone: null,
      });
      await seedContact(context, {
        id: "contact-real-b",
        displayName: "Real B",
        primaryPhone: null,
      });
      await context.db.insert(contactIdentities).values([
        {
          id: "identity-real-a-phone",
          contactId: "contact-real-a",
          kind: "phone",
          normalizedValue: "+19163001877",
          isPrimary: true,
          source: "manual",
          verifiedAt: null,
        },
        {
          id: "identity-real-b-phone",
          contactId: "contact-real-b",
          kind: "phone",
          normalizedValue: "+19163001877",
          isPrimary: true,
          source: "manual",
          verifiedAt: null,
        },
      ]);
      await seedContact(context, {
        id: "contact-unknown-multi",
        displayName: "Unknown (+1 916 300 1877)",
        primaryPhone: "9163001877",
      });

      const result = await mergeUnknownPhoneContacts({
        dryRun: false,
        db: context.db,
        repositories: context.repositories,
      });

      expect(result.merged).toBe(0);
      expect(result.skippedMultipleMatches).toBe(1);
      expect(result.actions[0]).toMatchObject({
        status: "skipped_multiple_matches",
        matchedContactIds: ["contact-real-a", "contact-real-b"],
      });
      await expect(
        context.repositories.contacts.findById("contact-unknown-multi"),
      ).resolves.toMatchObject({ id: "contact-unknown-multi" });
    } finally {
      await context.dispose();
    }
  });

  it("renders markdown summaries", () => {
    const markdown = renderMergeUnknownPhoneContactsMarkdown({
      dryRun: true,
      scanned: 3,
      merged: 1,
      skippedNoMatch: 1,
      skippedMultipleMatches: 1,
      actions: [
        {
          status: "merged",
          unknownContactId: "unknown-1",
          unknownDisplayName: "Unknown (+1 774 368 0124)",
          normalizedPhoneE164: "+17743680124",
          matchedContactIds: ["real-1"],
          mergedIntoContactId: "real-1",
          smsMessagesReattached: 0,
          canonicalEventsReattached: 0,
          consentRecordsReattached: 0,
        },
        {
          status: "skipped_no_match",
          unknownContactId: "unknown-2",
          unknownDisplayName: "Unknown (+1 406 555 0199)",
          normalizedPhoneE164: "+14065550199",
          matchedContactIds: [],
        },
        {
          status: "skipped_multiple_matches",
          unknownContactId: "unknown-3",
          unknownDisplayName: "Unknown (+1 916 300 1877)",
          normalizedPhoneE164: "+19163001877",
          matchedContactIds: ["real-a", "real-b"],
        },
      ],
    });

    expect(markdown).toContain("Mode: dry-run");
    expect(markdown).toContain("unknown-1 -> real-1");
    expect(markdown).toContain("unknown-2 [skipped_no_match]");
    expect(markdown).toContain("unknown-3 [skipped_multiple_matches]");
  });
});
