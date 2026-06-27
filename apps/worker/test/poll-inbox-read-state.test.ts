import { describe, expect, it, vi } from "vitest";

import {
  canonicalEventSchema,
  resolveCanonicalChannel,
  type CanonicalEventRecord,
  type GmailMessageDetailRecord,
  type SourceEvidenceRecord,
} from "@as-comms/contracts";

import {
  decideInboxBucketFromReplyAndReadState,
  pollInboxReadState,
  readGmailMessageReadState,
} from "../src/ops/poll-inbox-read-state.js";
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
}): SourceEvidenceRecord {
  return {
    id: `source:${input.key}`,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: `gmail:${input.key}`,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/gmail/${input.key}.json`,
    idempotencyKey: `gmail:message:${input.key}`,
    checksum: `checksum:${input.key}`,
  };
}

function buildCanonicalEvent(input: {
  readonly key: string;
  readonly contactId: string;
  readonly occurredAt: string;
  readonly direction: "inbound" | "outbound";
}): CanonicalEventRecord {
  const eventType =
    input.direction === "inbound"
      ? "communication.email.inbound"
      : "communication.email.outbound";

  return canonicalEventSchema.parse({
    id: `event:${input.key}`,
    contactId: input.contactId,
    eventType,
    channel: resolveCanonicalChannel(eventType),
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId: `source:${input.key}`,
    idempotencyKey: `canonical:${input.key}`,
    provenance: {
      primaryProvider: "gmail",
      primarySourceEvidenceId: `source:${input.key}`,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "message",
      sourceRecordId: `gmail:${input.key}`,
      messageKind: "one_to_one",
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
  readonly providerRecordId: string;
  readonly direction: GmailMessageDetailRecord["direction"];
  readonly gmailThreadId: string;
}): GmailMessageDetailRecord {
  return {
    sourceEvidenceId: `source:${input.key}`,
    providerRecordId: input.providerRecordId,
    gmailThreadId: input.gmailThreadId,
    rfc822MessageId: `<${input.key}@example.org>`,
    direction: input.direction,
    subject: `Subject ${input.key}`,
    fromHeader:
      input.direction === "outbound"
        ? "Inbox <orcas@adventurescientists.org>"
        : "Volunteer <volunteer@example.org>",
    toHeader:
      input.direction === "outbound"
        ? "Volunteer <volunteer@example.org>"
        : "Inbox <orcas@adventurescientists.org>",
    ccHeader: null,
    fromEmails:
      input.direction === "outbound"
        ? ["orcas@adventurescientists.org"]
        : ["volunteer@example.org"],
    toEmails:
      input.direction === "outbound"
        ? ["volunteer@example.org"]
        : ["orcas@adventurescientists.org"],
    ccEmails: [],
    bccEmails: [],
    labelIds: ["INBOX", "UNREAD"],
    snippetClean: `snippet:${input.key}`,
    bodyTextPreview: `body:${input.key}`,
    capturedMailbox: "volunteers@adventurescientists.org",
    projectInboxAlias: "orcas@adventurescientists.org",
  };
}

async function seedCanonicalEvent(input: {
  readonly context: TestWorkerContext;
  readonly event: CanonicalEventRecord;
  readonly sourceEvidence: SourceEvidenceRecord;
  readonly gmailDetail: GmailMessageDetailRecord;
}): Promise<void> {
  await input.context.repositories.sourceEvidence.append(input.sourceEvidence);
  await input.context.repositories.canonicalEvents.upsert(input.event);
  await input.context.repositories.gmailMessageDetails.upsert(input.gmailDetail);
}

async function seedInboxProjection(input: {
  readonly context: TestWorkerContext;
  readonly contactId: string;
  readonly bucket: "New" | "Opened";
  readonly lastCanonicalEventId: string;
  readonly lastEventType: CanonicalEventRecord["eventType"];
  readonly lastInboundAt: string | null;
  readonly lastOutboundAt: string | null;
  readonly lastActivityAt: string;
}): Promise<void> {
  await input.context.repositories.inboxProjection.upsert({
    contactId: input.contactId,
    bucket: input.bucket,
    needsFollowUp: false,
    hasUnresolved: false,
    lastInboundAt: input.lastInboundAt,
    lastOutboundAt: input.lastOutboundAt,
    lastActivityAt: input.lastActivityAt,
    snippet: `snippet:${input.contactId}`,
    archivedAt: null,
    lastCanonicalEventId: input.lastCanonicalEventId,
    lastEventType: input.lastEventType,
  });
}

describe("decideInboxBucketFromReplyAndReadState", () => {
  it.each([
    {
      hasInThreadReply: false,
      readState: "unread_in_inbox" as const,
      expected: "New",
    },
    {
      hasInThreadReply: false,
      readState: "read_or_out_of_inbox" as const,
      expected: "Opened",
    },
    {
      hasInThreadReply: false,
      readState: "unknown" as const,
      expected: "New",
    },
    {
      hasInThreadReply: true,
      readState: "unread_in_inbox" as const,
      expected: "Opened",
    },
    {
      hasInThreadReply: true,
      readState: "read_or_out_of_inbox" as const,
      expected: "Opened",
    },
    {
      hasInThreadReply: true,
      readState: "unknown" as const,
      expected: "Opened",
    },
  ])("returns $expected for %#", ({ hasInThreadReply, readState, expected }) => {
    expect(
      decideInboxBucketFromReplyAndReadState({
        hasInThreadReply,
        readState,
      }),
    ).toBe(expected);
  });
});

describe("readGmailMessageReadState", () => {
  it("classifies messages with both UNREAD and INBOX as unread in inbox", async () => {
    const gmailClient = {
      getMessage: vi.fn().mockResolvedValue({
        labelIds: ["INBOX", "UNREAD", "CATEGORY_PERSONAL"],
      }),
    };

    await expect(
      readGmailMessageReadState({
        gmailClient,
        mailbox: "volunteers@adventurescientists.org",
        messageId: "gmail-live-1",
      }),
    ).resolves.toBe("unread_in_inbox");
  });

  it("classifies messages missing either label as read or out of inbox", async () => {
    const gmailClient = {
      getMessage: vi.fn().mockResolvedValue({
        labelIds: ["INBOX"],
      }),
    };

    await expect(
      readGmailMessageReadState({
        gmailClient,
        mailbox: "volunteers@adventurescientists.org",
        messageId: "gmail-live-2",
      }),
    ).resolves.toBe("read_or_out_of_inbox");
  });

  it("returns unknown when getMessage throws", async () => {
    const gmailClient = {
      getMessage: vi.fn().mockRejectedValue(new Error("gmail 404")),
    };

    await expect(
      readGmailMessageReadState({
        gmailClient,
        mailbox: "volunteers@adventurescientists.org",
        messageId: "gmail-live-3",
      }),
    ).resolves.toBe("unknown");
  });
});

describe("pollInboxReadState", () => {
  it("opens New conversations when Gmail says the latest inbound is read or out of inbox", async () => {
    const context = await createTestWorkerContext();
    const readStateReader = vi
      .fn()
      .mockResolvedValue("read_or_out_of_inbox" as const);

    try {
      const contactId = "contact:read-opens";
      const inbound = buildCanonicalEvent({
        key: "read-opens-inbound",
        contactId,
        occurredAt: "2026-06-26T10:00:00.000Z",
        direction: "inbound",
      });

      await seedContact({
        context,
        contactId,
        email: "read-opens@example.org",
        displayName: "Read Opens",
      });
      await seedCanonicalEvent({
        context,
        event: inbound,
        sourceEvidence: buildSourceEvidence({
          key: "read-opens-inbound",
          occurredAt: inbound.occurredAt,
        }),
        gmailDetail: buildGmailDetail({
          key: "read-opens-inbound",
          providerRecordId: "gmail-live-read-opens",
          direction: "inbound",
          gmailThreadId: "thread:read-opens",
        }),
      });
      await seedInboxProjection({
        context,
        contactId,
        bucket: "New",
        lastCanonicalEventId: inbound.id,
        lastEventType: inbound.eventType,
        lastInboundAt: inbound.occurredAt,
        lastOutboundAt: null,
        lastActivityAt: inbound.occurredAt,
      });

      const report = await pollInboxReadState({
        db: context.db,
        persistence: context.persistence,
        mailbox: "volunteers@adventurescientists.org",
        gmailClient: { getMessage: vi.fn() },
        readStateReader,
      });

      await expect(
        context.repositories.inboxProjection.findByContactId(contactId),
      ).resolves.toMatchObject({
        bucket: "Opened",
      });
      expect(report).toEqual({
        processed: 1,
        openedByReply: 0,
        openedByRead: 1,
        stayedNew: 0,
        unknown: 0,
      });
    } finally {
      await context.dispose();
    }
  });

  it("keeps New conversations when Gmail still shows the latest inbound as unread in inbox", async () => {
    const context = await createTestWorkerContext();
    const readStateReader = vi
      .fn()
      .mockResolvedValue("unread_in_inbox" as const);

    try {
      const contactId = "contact:stays-new";
      const inbound = buildCanonicalEvent({
        key: "stays-new-inbound",
        contactId,
        occurredAt: "2026-06-26T10:05:00.000Z",
        direction: "inbound",
      });

      await seedContact({
        context,
        contactId,
        email: "stays-new@example.org",
        displayName: "Stays New",
      });
      await seedCanonicalEvent({
        context,
        event: inbound,
        sourceEvidence: buildSourceEvidence({
          key: "stays-new-inbound",
          occurredAt: inbound.occurredAt,
        }),
        gmailDetail: buildGmailDetail({
          key: "stays-new-inbound",
          providerRecordId: "gmail-live-stays-new",
          direction: "inbound",
          gmailThreadId: "thread:stays-new",
        }),
      });
      await seedInboxProjection({
        context,
        contactId,
        bucket: "New",
        lastCanonicalEventId: inbound.id,
        lastEventType: inbound.eventType,
        lastInboundAt: inbound.occurredAt,
        lastOutboundAt: null,
        lastActivityAt: inbound.occurredAt,
      });

      const report = await pollInboxReadState({
        db: context.db,
        persistence: context.persistence,
        mailbox: "volunteers@adventurescientists.org",
        gmailClient: { getMessage: vi.fn() },
        readStateReader,
      });

      await expect(
        context.repositories.inboxProjection.findByContactId(contactId),
      ).resolves.toMatchObject({
        bucket: "New",
      });
      expect(report).toEqual({
        processed: 1,
        openedByReply: 0,
        openedByRead: 0,
        stayedNew: 1,
        unknown: 0,
      });
    } finally {
      await context.dispose();
    }
  });

  it("opens New conversations when rebuild detects an in-thread reply", async () => {
    const context = await createTestWorkerContext();
    const readStateReader = vi
      .fn()
      .mockResolvedValue("unread_in_inbox" as const);

    try {
      const contactId = "contact:reply-opens";
      const inbound = buildCanonicalEvent({
        key: "reply-opens-inbound",
        contactId,
        occurredAt: "2026-06-26T10:10:00.000Z",
        direction: "inbound",
      });
      const outbound = buildCanonicalEvent({
        key: "reply-opens-outbound",
        contactId,
        occurredAt: "2026-06-26T10:20:00.000Z",
        direction: "outbound",
      });

      await seedContact({
        context,
        contactId,
        email: "reply-opens@example.org",
        displayName: "Reply Opens",
      });
      await seedCanonicalEvent({
        context,
        event: inbound,
        sourceEvidence: buildSourceEvidence({
          key: "reply-opens-inbound",
          occurredAt: inbound.occurredAt,
        }),
        gmailDetail: buildGmailDetail({
          key: "reply-opens-inbound",
          providerRecordId: "gmail-live-reply-opens-inbound",
          direction: "inbound",
          gmailThreadId: "thread:reply-opens",
        }),
      });
      await seedCanonicalEvent({
        context,
        event: outbound,
        sourceEvidence: buildSourceEvidence({
          key: "reply-opens-outbound",
          occurredAt: outbound.occurredAt,
        }),
        gmailDetail: buildGmailDetail({
          key: "reply-opens-outbound",
          providerRecordId: "gmail-live-reply-opens-outbound",
          direction: "outbound",
          gmailThreadId: "thread:reply-opens",
        }),
      });
      await seedInboxProjection({
        context,
        contactId,
        bucket: "New",
        lastCanonicalEventId: inbound.id,
        lastEventType: inbound.eventType,
        lastInboundAt: inbound.occurredAt,
        lastOutboundAt: null,
        lastActivityAt: inbound.occurredAt,
      });

      const report = await pollInboxReadState({
        db: context.db,
        persistence: context.persistence,
        mailbox: "volunteers@adventurescientists.org",
        gmailClient: { getMessage: vi.fn() },
        readStateReader,
      });

      await expect(
        context.repositories.inboxProjection.findByContactId(contactId),
      ).resolves.toMatchObject({
        bucket: "Opened",
      });
      expect(report).toEqual({
        processed: 1,
        openedByReply: 1,
        openedByRead: 0,
        stayedNew: 0,
        unknown: 0,
      });
    } finally {
      await context.dispose();
    }
  });

  it("leaves New conversations unchanged when Gmail read state is unknown", async () => {
    const context = await createTestWorkerContext();
    const readStateReader = vi.fn().mockResolvedValue("unknown" as const);

    try {
      const contactId = "contact:unknown-stays-new";
      const inbound = buildCanonicalEvent({
        key: "unknown-stays-new-inbound",
        contactId,
        occurredAt: "2026-06-26T10:25:00.000Z",
        direction: "inbound",
      });

      await seedContact({
        context,
        contactId,
        email: "unknown-stays-new@example.org",
        displayName: "Unknown Stays New",
      });
      await seedCanonicalEvent({
        context,
        event: inbound,
        sourceEvidence: buildSourceEvidence({
          key: "unknown-stays-new-inbound",
          occurredAt: inbound.occurredAt,
        }),
        gmailDetail: buildGmailDetail({
          key: "unknown-stays-new-inbound",
          providerRecordId: "mbox:unknown-stays-new",
          direction: "inbound",
          gmailThreadId: "thread:unknown-stays-new",
        }),
      });
      await seedInboxProjection({
        context,
        contactId,
        bucket: "New",
        lastCanonicalEventId: inbound.id,
        lastEventType: inbound.eventType,
        lastInboundAt: inbound.occurredAt,
        lastOutboundAt: null,
        lastActivityAt: inbound.occurredAt,
      });

      const report = await pollInboxReadState({
        db: context.db,
        persistence: context.persistence,
        mailbox: "volunteers@adventurescientists.org",
        gmailClient: { getMessage: vi.fn() },
        readStateReader,
      });

      await expect(
        context.repositories.inboxProjection.findByContactId(contactId),
      ).resolves.toMatchObject({
        bucket: "New",
      });
      expect(report).toEqual({
        processed: 1,
        openedByReply: 0,
        openedByRead: 0,
        stayedNew: 0,
        unknown: 1,
      });
    } finally {
      await context.dispose();
    }
  });
});
