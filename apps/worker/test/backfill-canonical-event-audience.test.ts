import { describe, expect, it } from "vitest";

import {
  canonicalEventAudience,
  contactInboxProjection,
  identityResolutionQueue,
} from "@as-comms/db";
import { asc, eq } from "drizzle-orm";

import {
  backfillCanonicalEventAudience,
  type BackfillCanonicalEventAudienceLogEntry,
} from "../src/ops/backfill-canonical-event-audience.js";
import { createTestWorkerContext } from "./helpers.js";

function buildCanonicalProvenance(input: {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly direction?: "inbound" | "outbound";
}) {
  return {
    primaryProvider: "gmail" as const,
    primarySourceEvidenceId: input.sourceEvidenceId,
    supportingSourceEvidenceIds: [],
    winnerReason: "single_source" as const,
    sourceRecordType: "message",
    sourceRecordId: input.providerRecordId,
    messageKind: "one_to_one" as const,
    campaignRef: null,
    threadRef: {
      crossProviderCollapseKey: `rfc822:<${input.providerRecordId}@example.org>`,
      providerThreadId: `thread:${input.providerRecordId}`,
    },
    direction: input.direction ?? "inbound",
    notes: null,
  };
}

async function seedContact(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly id: string;
  readonly email: string | null;
  readonly displayName?: string;
  readonly salesforceContactId?: string | null;
}): Promise<void> {
  await input.context.repositories.contacts.upsert({
    id: input.id,
    salesforceContactId: input.salesforceContactId ?? null,
    displayName: input.displayName ?? input.id,
    primaryEmail: input.email,
    primaryPhone: null,
    createdAt: "2026-05-10T09:00:00.000Z",
    updatedAt: "2026-05-10T09:00:00.000Z",
  });

  if (input.email !== null) {
    await input.context.repositories.contactIdentities.upsert({
      id: `identity:${input.id}:email:${input.email}`,
      contactId: input.id,
      kind: "email",
      normalizedValue: input.email,
      isPrimary: true,
      source: input.salesforceContactId == null ? "manual" : "salesforce",
      verifiedAt: "2026-05-10T09:00:00.000Z",
    });
  }
}

async function seedInboxProjection(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly contactId: string;
  readonly lastInboundAt?: string | null;
  readonly lastOutboundAt?: string | null;
  readonly lastActivityAt: string;
  readonly hasUnresolved?: boolean;
  readonly lastCanonicalEventId: string;
  readonly lastEventType?: "communication.email.inbound" | "communication.email.outbound";
}): Promise<void> {
  await input.context.repositories.inboxProjection.upsert({
    contactId: input.contactId,
    bucket: "Opened",
    needsFollowUp: false,
    hasUnresolved: input.hasUnresolved ?? false,
    lastInboundAt: input.lastInboundAt ?? null,
    lastOutboundAt: input.lastOutboundAt ?? null,
    lastActivityAt: input.lastActivityAt,
    snippet: `Projection for ${input.contactId}`,
    archivedAt: null,
    lastCanonicalEventId: input.lastCanonicalEventId,
    lastEventType: input.lastEventType ?? "communication.email.inbound",
  });
}

async function seedGmailCanonicalEvent(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly canonicalEventId: string;
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly contactId: string;
  readonly occurredAt: string;
  readonly direction?: "inbound" | "outbound";
  readonly fromEmails?: readonly string[];
  readonly toEmails?: readonly string[];
  readonly ccEmails?: readonly string[];
  readonly bccEmails?: readonly string[];
}): Promise<void> {
  await input.context.repositories.sourceEvidence.append({
    id: input.sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.providerRecordId,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `gmail://message/${input.providerRecordId}`,
    idempotencyKey: input.sourceEvidenceId,
    checksum: `checksum:${input.providerRecordId}`,
  });

  await input.context.repositories.canonicalEvents.upsert({
    id: input.canonicalEventId,
    contactId: input.contactId,
    eventType:
      (input.direction ?? "inbound") === "outbound"
        ? "communication.email.outbound"
        : "communication.email.inbound",
    channel: "email",
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId: input.sourceEvidenceId,
    idempotencyKey: input.canonicalEventId,
    provenance: buildCanonicalProvenance(
      input.direction === undefined
        ? {
            sourceEvidenceId: input.sourceEvidenceId,
            providerRecordId: input.providerRecordId,
          }
        : {
            sourceEvidenceId: input.sourceEvidenceId,
            providerRecordId: input.providerRecordId,
            direction: input.direction,
          },
    ),
    reviewState: "clear",
  });

  await input.context.repositories.gmailMessageDetails.upsert({
    sourceEvidenceId: input.sourceEvidenceId,
    providerRecordId: input.providerRecordId,
    gmailThreadId: `thread:${input.providerRecordId}`,
    rfc822MessageId: `<${input.providerRecordId}@example.org>`,
    direction: input.direction ?? "inbound",
    subject: `Subject ${input.providerRecordId}`,
    fromHeader: null,
    toHeader: null,
    ccHeader: null,
    fromEmails: [...(input.fromEmails ?? [])],
    toEmails: [...(input.toEmails ?? [])],
    ccEmails: [...(input.ccEmails ?? [])],
    bccEmails: [...(input.bccEmails ?? [])],
    labelIds: ["INBOX"],
    snippetClean: "Snippet",
    bodyTextPreview: "Preview",
    bodyKind: "plaintext",
    capturedMailbox: "volunteers@adventurescientists.org",
    projectInboxAlias: null,
  });
}

async function loadAudienceRows(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>,
) {
  return context.db
    .select()
    .from(canonicalEventAudience)
    .orderBy(
      asc(canonicalEventAudience.canonicalEventId),
      asc(canonicalEventAudience.contactId),
    );
}

function createLogger(logs: BackfillCanonicalEventAudienceLogEntry[]) {
  return {
    log(value: unknown) {
      if (typeof value === "string" && value.startsWith("{")) {
        logs.push(JSON.parse(value) as BackfillCanonicalEventAudienceLogEntry);
      }
    },
    error() {
      return undefined;
    },
  };
}

describe("backfill-canonical-event-audience", () => {
  it("dry-runs then commits a multi-recipient inbound Gmail event", async () => {
    const context = await createTestWorkerContext();
    const logs: BackfillCanonicalEventAudienceLogEntry[] = [];

    try {
      await seedContact({
        context,
        id: "contact:sender",
        email: "sender@example.org",
        salesforceContactId: "003SENDER",
      });
      await seedContact({
        context,
        id: "contact:to",
        email: "to@example.org",
        salesforceContactId: "003TO",
      });
      await seedContact({
        context,
        id: "contact:cc",
        email: "cc@example.org",
        salesforceContactId: "003CC",
      });
      await seedGmailCanonicalEvent({
        context,
        canonicalEventId: "canonical-event:multi",
        sourceEvidenceId: "source-evidence:gmail:multi",
        providerRecordId: "gmail-multi",
        contactId: "contact:sender",
        occurredAt: "2026-05-20T10:00:00.000Z",
        fromEmails: ["sender@example.org"],
        toEmails: ["to@example.org"],
        ccEmails: ["cc@example.org"],
      });

      const dryRun = await backfillCanonicalEventAudience({
        db: context.db,
        repositories: context.repositories,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: false,
        limit: 100,
        logger: createLogger(logs),
      });

      expect(dryRun).toMatchObject({
        dryRun: true,
        candidates: 1,
        applied: 1,
        skipped: 0,
      });
      await expect(loadAudienceRows(context)).resolves.toHaveLength(0);
      expect(logs).toContainEqual({
        action: "dryRun",
        canonicalEventId: "canonical-event:multi",
        sourceEvidenceId: "source-evidence:gmail:multi",
        audienceCount: 3,
      });

      const executeResult = await backfillCanonicalEventAudience({
        db: context.db,
        repositories: context.repositories,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: true,
        limit: 100,
        logger: createLogger([]),
      });

      expect(executeResult).toMatchObject({
        dryRun: false,
        candidates: 1,
        applied: 1,
      });
      await expect(loadAudienceRows(context)).resolves.toEqual([
        expect.objectContaining({
          canonicalEventId: "canonical-event:multi",
          contactId: "contact:cc",
          participantRole: "cc",
          normalizedEmail: "cc@example.org",
        }),
        expect.objectContaining({
          canonicalEventId: "canonical-event:multi",
          contactId: "contact:sender",
          participantRole: "sender",
          normalizedEmail: "sender@example.org",
        }),
        expect.objectContaining({
          canonicalEventId: "canonical-event:multi",
          contactId: "contact:to",
          participantRole: "direct_recipient",
          normalizedEmail: "to@example.org",
        }),
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("creates a new contact for an unseen external audience participant", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        id: "contact:staff",
        email: "staff@adventurescientists.org",
        salesforceContactId: "003STAFF",
      });
      await seedGmailCanonicalEvent({
        context,
        canonicalEventId: "canonical-event:new-external",
        sourceEvidenceId: "source-evidence:gmail:new-external",
        providerRecordId: "gmail-new-external",
        contactId: "contact:staff",
        occurredAt: "2026-05-21T12:00:00.000Z",
        direction: "outbound",
        fromEmails: ["staff@adventurescientists.org"],
        toEmails: ["new.external@example.org"],
      });

      const beforeContacts = await context.repositories.contacts.listAll();
      const result = await backfillCanonicalEventAudience({
        db: context.db,
        repositories: context.repositories,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: true,
        limit: 100,
      });
      const afterContacts = await context.repositories.contacts.listAll();
      const audienceRows = await loadAudienceRows(context);

      expect(result).toMatchObject({
        candidates: 1,
        applied: 1,
      });
      expect(afterContacts).toHaveLength(beforeContacts.length + 1);
      expect(afterContacts.some((contact) => contact.primaryEmail === "new.external@example.org")).toBe(true);
      expect(audienceRows).toHaveLength(2);
      expect(audienceRows.map((row) => row.normalizedEmail)).toEqual([
        "new.external@example.org",
        "staff@adventurescientists.org",
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("opens an identity case and refreshes the inbox overlay for multi-candidate email matches", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        id: "contact:anchor",
        email: "anchor@example.org",
        salesforceContactId: "003ANCHOR",
      });
      await seedContact({
        context,
        id: "contact:winner",
        email: "shared@example.org",
        salesforceContactId: "003WINNER",
      });
      await seedContact({
        context,
        id: "contact:loser",
        email: "shared@example.org",
        salesforceContactId: "003LOSER",
      });
      await seedGmailCanonicalEvent({
        context,
        canonicalEventId: "canonical-event:winner-history",
        sourceEvidenceId: "source-evidence:gmail:winner-history",
        providerRecordId: "gmail-winner-history",
        contactId: "contact:winner",
        occurredAt: "2026-04-19T12:00:00.000Z",
        fromEmails: ["shared@example.org"],
      });
      await seedGmailCanonicalEvent({
        context,
        canonicalEventId: "canonical-event:loser-history",
        sourceEvidenceId: "source-evidence:gmail:loser-history",
        providerRecordId: "gmail-loser-history",
        contactId: "contact:loser",
        occurredAt: "2026-04-10T12:00:00.000Z",
        fromEmails: ["shared@example.org"],
      });
      await seedInboxProjection({
        context,
        contactId: "contact:winner",
        lastInboundAt: "2026-05-19T12:00:00.000Z",
        lastActivityAt: "2026-05-19T12:00:00.000Z",
        hasUnresolved: false,
        lastCanonicalEventId: "canonical-event:winner-history",
      });
      await seedInboxProjection({
        context,
        contactId: "contact:loser",
        lastInboundAt: "2026-05-10T12:00:00.000Z",
        lastActivityAt: "2026-05-10T12:00:00.000Z",
        hasUnresolved: false,
        lastCanonicalEventId: "canonical-event:loser-history",
      });
      await seedGmailCanonicalEvent({
        context,
        canonicalEventId: "canonical-event:multi-candidate",
        sourceEvidenceId: "source-evidence:gmail:multi-candidate",
        providerRecordId: "gmail-multi-candidate",
        contactId: "contact:anchor",
        occurredAt: "2026-05-22T08:00:00.000Z",
        fromEmails: ["anchor@example.org"],
        toEmails: ["shared@example.org"],
      });

      const result = await backfillCanonicalEventAudience({
        db: context.db,
        repositories: context.repositories,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: true,
        limit: 100,
      });
      const audienceRows = await loadAudienceRows(context);
      const identityCases = await context.db
        .select()
        .from(identityResolutionQueue)
        .where(
          eq(
            identityResolutionQueue.sourceEvidenceId,
            "source-evidence:gmail:multi-candidate",
          ),
        );
      const [winnerProjection] = await context.db
        .select()
        .from(contactInboxProjection)
        .where(eq(contactInboxProjection.contactId, "contact:winner"));

      expect(result).toMatchObject({
        candidates: 1,
        applied: 1,
      });
      expect(audienceRows).toEqual([
        expect.objectContaining({
          canonicalEventId: "canonical-event:multi-candidate",
          contactId: "contact:anchor",
          participantRole: "sender",
        }),
        expect.objectContaining({
          canonicalEventId: "canonical-event:multi-candidate",
          contactId: "contact:winner",
          participantRole: "direct_recipient",
          normalizedEmail: "shared@example.org",
        }),
      ]);
      expect(identityCases).toHaveLength(1);
      expect(identityCases[0]).toMatchObject({
        reasonCode: "identity_multi_candidate",
        anchoredContactId: "contact:winner",
        candidateContactIds: ["contact:loser"],
        normalizedIdentityValues: ["shared@example.org"],
        status: "open",
      });
      expect(winnerProjection).toMatchObject({
        hasUnresolved: true,
      });
    } finally {
      await context.dispose();
    }
  });

  it("skips events that already have audience rows", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        id: "contact:existing",
        email: "existing@example.org",
        salesforceContactId: "003EXISTING",
      });
      await seedGmailCanonicalEvent({
        context,
        canonicalEventId: "canonical-event:existing-audience",
        sourceEvidenceId: "source-evidence:gmail:existing-audience",
        providerRecordId: "gmail-existing-audience",
        contactId: "contact:existing",
        occurredAt: "2026-05-23T08:00:00.000Z",
        fromEmails: ["existing@example.org"],
      });
      await context.repositories.canonicalEventAudience.upsert({
        canonicalEventId: "canonical-event:existing-audience",
        contactId: "contact:existing",
        participantRole: "sender",
        normalizedEmail: "existing@example.org",
      });

      const result = await backfillCanonicalEventAudience({
        db: context.db,
        repositories: context.repositories,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: true,
        limit: 100,
      });

      expect(result).toMatchObject({
        candidates: 0,
        applied: 0,
        skipped: 0,
      });
      await expect(loadAudienceRows(context)).resolves.toHaveLength(1);
    } finally {
      await context.dispose();
    }
  });

  it("excludes non-Gmail events from the candidate set", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        id: "contact:salesforce-email",
        email: "sf@example.org",
        salesforceContactId: "003SF",
      });
      await context.repositories.sourceEvidence.append({
        id: "source-evidence:salesforce:email-1",
        provider: "salesforce",
        providerRecordType: "task_communication",
        providerRecordId: "task-1",
        receivedAt: "2026-05-24T08:00:00.000Z",
        occurredAt: "2026-05-24T08:00:00.000Z",
        payloadRef: "salesforce://task/task-1",
        idempotencyKey: "source-evidence:salesforce:email-1",
        checksum: "checksum:task-1",
      });
      await context.repositories.canonicalEvents.upsert({
        id: "canonical-event:salesforce-email",
        contactId: "contact:salesforce-email",
        eventType: "communication.email.inbound",
        channel: "email",
        occurredAt: "2026-05-24T08:00:00.000Z",
        contentFingerprint: null,
        sourceEvidenceId: "source-evidence:salesforce:email-1",
        idempotencyKey: "canonical-event:salesforce-email",
        provenance: {
          primaryProvider: "salesforce" as const,
          primarySourceEvidenceId: "source-evidence:salesforce:email-1",
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source" as const,
          sourceRecordType: "task_communication",
          sourceRecordId: "task-1",
          messageKind: "one_to_one" as const,
          campaignRef: null,
          threadRef: null,
          direction: "inbound" as const,
          notes: null,
        },
        reviewState: "clear",
      });

      const result = await backfillCanonicalEventAudience({
        db: context.db,
        repositories: context.repositories,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: true,
        limit: 100,
      });

      expect(result).toMatchObject({
        candidates: 0,
        applied: 0,
      });
    } finally {
      await context.dispose();
    }
  });

  it("respects the since and until window", async () => {
    const context = await createTestWorkerContext();
    const logs: BackfillCanonicalEventAudienceLogEntry[] = [];

    try {
      await seedContact({
        context,
        id: "contact:window",
        email: "window@example.org",
        salesforceContactId: "003WINDOW",
      });
      await seedGmailCanonicalEvent({
        context,
        canonicalEventId: "canonical-event:window-inside",
        sourceEvidenceId: "source-evidence:gmail:window-inside",
        providerRecordId: "gmail-window-inside",
        contactId: "contact:window",
        occurredAt: "2026-05-20T10:00:00.000Z",
        fromEmails: ["window@example.org"],
      });
      await seedGmailCanonicalEvent({
        context,
        canonicalEventId: "canonical-event:window-outside",
        sourceEvidenceId: "source-evidence:gmail:window-outside",
        providerRecordId: "gmail-window-outside",
        contactId: "contact:window",
        occurredAt: "2026-04-20T10:00:00.000Z",
        fromEmails: ["window@example.org"],
      });

      const result = await backfillCanonicalEventAudience({
        db: context.db,
        repositories: context.repositories,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: false,
        limit: 100,
        logger: createLogger(logs),
      });

      expect(result).toMatchObject({
        candidates: 1,
        applied: 1,
      });
      expect(logs).toContainEqual({
        action: "dryRun",
        canonicalEventId: "canonical-event:window-inside",
        sourceEvidenceId: "source-evidence:gmail:window-inside",
        audienceCount: 1,
      });
      expect(
        logs.some(
          (entry) => entry.canonicalEventId === "canonical-event:window-outside",
        ),
      ).toBe(false);
    } finally {
      await context.dispose();
    }
  });

  it("skips Gmail events whose header email arrays are empty", async () => {
    const context = await createTestWorkerContext();
    const logs: BackfillCanonicalEventAudienceLogEntry[] = [];

    try {
      await seedContact({
        context,
        id: "contact:empty",
        email: "empty@example.org",
        salesforceContactId: "003EMPTY",
      });
      await seedGmailCanonicalEvent({
        context,
        canonicalEventId: "canonical-event:empty-headers",
        sourceEvidenceId: "source-evidence:gmail:empty-headers",
        providerRecordId: "gmail-empty-headers",
        contactId: "contact:empty",
        occurredAt: "2026-05-25T08:00:00.000Z",
      });

      const result = await backfillCanonicalEventAudience({
        db: context.db,
        repositories: context.repositories,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: true,
        limit: 100,
        logger: createLogger(logs),
      });

      expect(result).toMatchObject({
        candidates: 1,
        applied: 0,
        skipped: 1,
        byReason: {
          no_gmail_detail: 0,
          no_header_emails: 1,
        },
      });
      expect(logs).toContainEqual({
        action: "skipped",
        canonicalEventId: "canonical-event:empty-headers",
        sourceEvidenceId: "source-evidence:gmail:empty-headers",
        reason: "no_header_emails",
      });
      await expect(loadAudienceRows(context)).resolves.toHaveLength(0);
    } finally {
      await context.dispose();
    }
  });
});
