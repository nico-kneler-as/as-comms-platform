import { describe, expect, it } from "vitest";

import {
  canonicalEventSchema,
  resolveCanonicalChannel,
  type CanonicalEventRecord,
  type GmailMessageDetailRecord,
  type SourceEvidenceRecord,
} from "@as-comms/contracts";

import {
  rebuildInboxProjectionSnippetBias,
} from "../src/ops/rebuild-inbox-projection-snippet-bias.js";
import { createTestWorkerContext, type TestWorkerContext } from "./helpers.js";

async function seedContact(input: {
  readonly context: TestWorkerContext;
  readonly contactId: string;
  readonly email: string;
  readonly displayName: string;
}): Promise<void> {
  await input.context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: input.contactId,
      salesforceContactId: null,
      displayName: input.displayName,
      primaryEmail: input.email,
      primaryPhone: null,
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
    },
    identities: [
      {
        id: `identity:${input.contactId}:email`,
        contactId: input.contactId,
        kind: "email",
        normalizedValue: input.email,
        isPrimary: true,
        source: "gmail",
        verifiedAt: "2026-06-03T00:00:00.000Z",
      },
    ],
    memberships: [],
  });
}

function buildSourceEvidence(input: {
  readonly key: string;
  readonly occurredAt: string;
  readonly provider: SourceEvidenceRecord["provider"];
  readonly providerRecordType: SourceEvidenceRecord["providerRecordType"];
}): SourceEvidenceRecord {
  return {
    id: `source:${input.key}`,
    provider: input.provider,
    providerRecordType: input.providerRecordType,
    providerRecordId: `${input.provider}:${input.key}`,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/${input.provider}/${input.key}.json`,
    idempotencyKey: `${input.provider}:${input.providerRecordType}:${input.key}`,
    checksum: `checksum:${input.key}`,
  };
}

function buildCanonicalEvent(input: {
  readonly key: string;
  readonly contactId: string;
  readonly occurredAt: string;
  readonly eventType: CanonicalEventRecord["eventType"];
  readonly provider: CanonicalEventRecord["provenance"]["primaryProvider"];
  readonly sourceRecordType: CanonicalEventRecord["provenance"]["sourceRecordType"];
  readonly direction: "inbound" | "outbound" | null;
  readonly messageKind: CanonicalEventRecord["provenance"]["messageKind"];
}): CanonicalEventRecord {
  return canonicalEventSchema.parse({
    id: `event:${input.key}`,
    contactId: input.contactId,
    eventType: input.eventType,
    channel: resolveCanonicalChannel(input.eventType),
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId: `source:${input.key}`,
    idempotencyKey: `canonical:${input.key}`,
    provenance: {
      primaryProvider: input.provider,
      primarySourceEvidenceId: `source:${input.key}`,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: input.sourceRecordType,
      sourceRecordId: `${input.provider}:${input.key}`,
      messageKind: input.messageKind,
      campaignRef: null,
      threadRef: null,
      direction: input.direction,
      notes: null,
    },
    reviewState: "clear",
  });
}

function buildGmailDetail(input: {
  readonly key: string;
  readonly direction: GmailMessageDetailRecord["direction"];
  readonly gmailThreadId: string;
  readonly rfc822MessageId: string;
  readonly snippet: string;
}): GmailMessageDetailRecord {
  return {
    sourceEvidenceId: `source:${input.key}`,
    providerRecordId: `gmail:${input.key}`,
    gmailThreadId: input.gmailThreadId,
    rfc822MessageId: input.rfc822MessageId,
    direction: input.direction,
    subject: `Subject ${input.key}`,
    fromHeader:
      input.direction === "outbound"
        ? "Inbox <forests@adventurescientists.org>"
        : "Volunteer <volunteer@example.org>",
    toHeader:
      input.direction === "outbound"
        ? "Volunteer <volunteer@example.org>"
        : "Inbox <forests@adventurescientists.org>",
    ccHeader: null,
    fromEmails:
      input.direction === "outbound"
        ? ["forests@adventurescientists.org"]
        : ["volunteer@example.org"],
    toEmails:
      input.direction === "outbound"
        ? ["volunteer@example.org"]
        : ["forests@adventurescientists.org"],
    ccEmails: [],
    bccEmails: [],
    snippetClean: input.snippet,
    bodyTextPreview: input.snippet,
    capturedMailbox: "volunteers@adventurescientists.org",
    projectInboxAlias: "forests@adventurescientists.org",
  };
}

async function seedCanonicalEvent(input: {
  readonly context: TestWorkerContext;
  readonly event: CanonicalEventRecord;
  readonly sourceEvidence: SourceEvidenceRecord;
  readonly gmailDetail?: GmailMessageDetailRecord;
}): Promise<void> {
  await input.context.repositories.sourceEvidence.append(input.sourceEvidence);
  await input.context.repositories.canonicalEvents.upsert(input.event);

  if (input.gmailDetail !== undefined) {
    await input.context.repositories.gmailMessageDetails.upsert(input.gmailDetail);
  }
}

describe("rebuild-inbox-projection-snippet-bias ops", () => {
  it("rebuilds stale Gary-like snippets toward the latest meaningful inbound", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact:gary",
        email: "gary@example.org",
        displayName: "Gary Steele",
      });

      const inbound = buildCanonicalEvent({
        key: "gary-inbound",
        contactId: "contact:gary",
        occurredAt: "2026-06-03T10:00:00.000Z",
        eventType: "communication.email.inbound",
        provider: "gmail",
        sourceRecordType: "message",
        direction: "inbound",
        messageKind: "one_to_one",
      });
      const campaignOpened = buildCanonicalEvent({
        key: "gary-opened",
        contactId: "contact:gary",
        occurredAt: "2026-06-03T11:00:00.000Z",
        eventType: "campaign.email.opened",
        provider: "mailchimp",
        sourceRecordType: "campaign_activity",
        direction: null,
        messageKind: "campaign",
      });

      await seedCanonicalEvent({
        context,
        event: inbound,
        sourceEvidence: buildSourceEvidence({
          key: "gary-inbound",
          occurredAt: inbound.occurredAt,
          provider: "gmail",
          providerRecordType: "message",
        }),
        gmailDetail: buildGmailDetail({
          key: "gary-inbound",
          direction: "inbound",
          gmailThreadId: "thread:gary",
          rfc822MessageId: "<gary-inbound@example.org>",
          snippet:
            "I went to pick it up today and Weaverville had no units to give me.",
        }),
      });
      await seedCanonicalEvent({
        context,
        event: campaignOpened,
        sourceEvidence: buildSourceEvidence({
          key: "gary-opened",
          occurredAt: campaignOpened.occurredAt,
          provider: "mailchimp",
          providerRecordType: "campaign_activity",
        }),
      });

      await context.repositories.inboxProjection.upsert({
        contactId: "contact:gary",
        bucket: "New",
        needsFollowUp: false,
        hasUnresolved: false,
        lastInboundAt: inbound.occurredAt,
        lastOutboundAt: null,
        lastActivityAt: campaignOpened.occurredAt,
        snippet: "Broadcast email opened",
        archivedAt: null,
        lastCanonicalEventId: campaignOpened.id,
        lastEventType: campaignOpened.eventType,
      });

      const result = await rebuildInboxProjectionSnippetBias({
        connection: { db: context.db },
        logger: {
          log(..._args) {
            void _args;
          },
          error(..._args) {
            void _args;
          },
        },
      });
      const projection =
        await context.repositories.inboxProjection.findByContactId("contact:gary");

      expect(result).toMatchObject({
        processed: 1,
        changed: 1,
        unchanged: 0,
      });
      expect(projection?.snippet).toBe(
        "I went to pick it up today and Weaverville had no units to give me.",
      );
      expect(projection?.lastEventType).toBe("campaign.email.opened");
    } finally {
      await context.dispose();
    }
  });
});
