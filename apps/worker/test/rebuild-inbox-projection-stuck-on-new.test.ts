import { describe, expect, it } from "vitest";

import {
  canonicalEventSchema,
  resolveCanonicalChannel,
  type CanonicalEventRecord,
  type GmailMessageDetailRecord,
  type SourceEvidenceRecord,
} from "@as-comms/contracts";
import { users } from "@as-comms/db";

import {
  rebuildInboxProjectionStuckOnNew,
} from "../src/ops/rebuild-inbox-projection-stuck-on-new.js";
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
  readonly direction: GmailMessageDetailRecord["direction"];
  readonly gmailThreadId: string;
  readonly rfc822MessageId: string;
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
    snippetClean: `Snippet ${input.key}`,
    bodyTextPreview: `Body ${input.key}`,
    capturedMailbox: "volunteers@adventurescientists.org",
    projectInboxAlias: "forests@adventurescientists.org",
  };
}

async function seedCanonicalEmailEvent(input: {
  readonly context: TestWorkerContext;
  readonly event: CanonicalEventRecord;
  readonly gmailDetail: GmailMessageDetailRecord;
}): Promise<void> {
  await input.context.repositories.sourceEvidence.append(
    buildSourceEvidence({
      key: input.event.id.replace("event:", ""),
      occurredAt: input.event.occurredAt,
    }),
  );
  await input.context.repositories.canonicalEvents.upsert(input.event);
  await input.context.repositories.gmailMessageDetails.upsert(input.gmailDetail);
}

async function seedPendingOutboundActor(context: TestWorkerContext): Promise<void> {
  await context.db.insert(users).values({
    id: "user:operator",
    email: "operator@example.org",
    name: "Operator",
    role: "operator",
    image: null,
    emailVerified: null,
    deactivatedAt: null,
    createdAt: new Date("2026-06-03T00:00:00.000Z"),
    updatedAt: new Date("2026-06-03T00:00:00.000Z"),
  });
}

async function runBucketFix(
  context: TestWorkerContext,
): Promise<Awaited<ReturnType<typeof rebuildInboxProjectionStuckOnNew>>> {
  return rebuildInboxProjectionStuckOnNew({
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
}

describe("rebuild-inbox-projection-stuck-on-new ops", () => {
  it("transitions Roy-like in-thread replies from New to Opened", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact:roy",
        email: "roy@example.org",
        displayName: "Roy Ramthun",
      });

      const inbound = buildCanonicalEvent({
        key: "roy-inbound",
        contactId: "contact:roy",
        occurredAt: "2026-06-03T10:00:00.000Z",
        direction: "inbound",
      });
      const outbound = buildCanonicalEvent({
        key: "roy-outbound",
        contactId: "contact:roy",
        occurredAt: "2026-06-03T10:30:00.000Z",
        direction: "outbound",
      });

      await seedCanonicalEmailEvent({
        context,
        event: inbound,
        gmailDetail: buildGmailDetail({
          key: "roy-inbound",
          direction: "inbound",
          gmailThreadId: "thread:roy",
          rfc822MessageId: "<roy-inbound@example.org>",
        }),
      });
      await seedCanonicalEmailEvent({
        context,
        event: outbound,
        gmailDetail: buildGmailDetail({
          key: "roy-outbound",
          direction: "outbound",
          gmailThreadId: "thread:roy",
          rfc822MessageId: "<roy-outbound@example.org>",
        }),
      });
      await context.repositories.inboxProjection.upsert({
        contactId: "contact:roy",
        bucket: "New",
        needsFollowUp: false,
        hasUnresolved: false,
        lastInboundAt: inbound.occurredAt,
        lastOutboundAt: outbound.occurredAt,
        lastActivityAt: outbound.occurredAt,
        snippet: "Roy stuck on new",
        archivedAt: null,
        lastCanonicalEventId: outbound.id,
        lastEventType: outbound.eventType,
      });

      const result = await runBucketFix(context);
      const projection =
        await context.repositories.inboxProjection.findByContactId("contact:roy");

      expect(result).toMatchObject({
        processed: 1,
        opened: 1,
        unchanged: 0,
      });
      expect(projection?.bucket).toBe("Opened");
    } finally {
      await context.dispose();
    }
  });

  it("keeps Caitlin-like compose-new activity in New when inReplyToRfc822 is null", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact:caitlin",
        email: "caitlin@example.org",
        displayName: "Caitlin Bean",
      });
      await seedPendingOutboundActor(context);

      const inbound = buildCanonicalEvent({
        key: "caitlin-inbound",
        contactId: "contact:caitlin",
        occurredAt: "2026-06-03T11:00:00.000Z",
        direction: "inbound",
      });
      const outbound = buildCanonicalEvent({
        key: "caitlin-outbound",
        contactId: "contact:caitlin",
        occurredAt: "2026-06-03T11:30:00.000Z",
        direction: "outbound",
      });

      await seedCanonicalEmailEvent({
        context,
        event: inbound,
        gmailDetail: buildGmailDetail({
          key: "caitlin-inbound",
          direction: "inbound",
          gmailThreadId: "thread:caitlin-inbound",
          rfc822MessageId: "<caitlin-inbound@example.org>",
        }),
      });
      await seedCanonicalEmailEvent({
        context,
        event: outbound,
        gmailDetail: buildGmailDetail({
          key: "caitlin-outbound",
          direction: "outbound",
          gmailThreadId: "thread:caitlin-compose-new",
          rfc822MessageId: "<caitlin-outbound@example.org>",
        }),
      });
      await context.repositories.pendingOutbounds.insert({
        id: "pending:caitlin-compose-new",
        fingerprint: "fingerprint:caitlin-compose-new",
        actorId: "user:operator",
        canonicalContactId: "contact:caitlin",
        projectId: null,
        fromAlias: "forests@adventurescientists.org",
        toEmailNormalized: "caitlin@example.org",
        subject: "Fresh thread",
        bodyPlaintext: "A separate outbound",
        bodyHtml: null,
        bodySha256: "sha256:caitlin-compose-new",
        attachmentMetadata: [],
        gmailThreadId: "thread:caitlin-compose-new",
        inReplyToRfc822: null,
        attemptedAt: "2026-06-03T11:30:00.000Z",
      });
      await context.repositories.pendingOutbounds.markSentRfc822(
        "pending:caitlin-compose-new",
        "<caitlin-outbound@example.org>",
      );
      await context.repositories.inboxProjection.upsert({
        contactId: "contact:caitlin",
        bucket: "New",
        needsFollowUp: false,
        hasUnresolved: false,
        lastInboundAt: inbound.occurredAt,
        lastOutboundAt: outbound.occurredAt,
        lastActivityAt: outbound.occurredAt,
        snippet: "Caitlin stuck on new",
        archivedAt: null,
        lastCanonicalEventId: outbound.id,
        lastEventType: outbound.eventType,
      });

      const result = await runBucketFix(context);
      const projection = await context.repositories.inboxProjection.findByContactId(
        "contact:caitlin",
      );

      expect(result).toMatchObject({
        processed: 1,
        opened: 0,
        unchanged: 1,
      });
      expect(projection?.bucket).toBe("New");
    } finally {
      await context.dispose();
    }
  });
});
