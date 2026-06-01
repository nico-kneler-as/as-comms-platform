import { describe, expect, it } from "vitest";

import {
  canonicalEventAudience,
  contacts,
} from "@as-comms/db";
import { eq } from "drizzle-orm";

import {
  backfillContactDisplayNames,
  type BackfillContactDisplayNamesLogEntry,
} from "../src/ops/backfill-contact-display-names.js";
import { createTestWorkerContext } from "./helpers.js";

function buildCanonicalProvenance(input: {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
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
    direction: "inbound" as const,
    notes: null,
  };
}

async function seedContact(input: {
  readonly repositories: Awaited<
    ReturnType<typeof createTestWorkerContext>
  >["repositories"];
  readonly id: string;
  readonly primaryEmail: string;
  readonly displayName: string;
}): Promise<void> {
  await input.repositories.contacts.upsert({
    id: input.id,
    salesforceContactId: null,
    displayName: input.displayName,
    primaryEmail: input.primaryEmail,
    primaryPhone: null,
    createdAt: "2026-05-10T09:00:00.000Z",
    updatedAt: "2026-05-10T09:00:00.000Z",
  });

  await input.repositories.contactIdentities.upsert({
    id: `identity:${input.id}:email:${input.primaryEmail}`,
    contactId: input.id,
    kind: "email",
    normalizedValue: input.primaryEmail,
    isPrimary: true,
    source: "gmail",
    verifiedAt: "2026-05-10T09:00:00.000Z",
  });
}

async function seedGmailEvent(input: {
  readonly repositories: Awaited<
    ReturnType<typeof createTestWorkerContext>
  >["repositories"];
  readonly canonicalEventId: string;
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly contactId: string;
  readonly occurredAt: string;
  readonly fromHeader?: string | null;
  readonly toHeader?: string | null;
  readonly ccHeader?: string | null;
}): Promise<void> {
  await input.repositories.sourceEvidence.append({
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

  await input.repositories.canonicalEvents.upsert({
    id: input.canonicalEventId,
    contactId: input.contactId,
    eventType: "communication.email.inbound",
    channel: "email",
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId: input.sourceEvidenceId,
    idempotencyKey: input.canonicalEventId,
    provenance: buildCanonicalProvenance({
      sourceEvidenceId: input.sourceEvidenceId,
      providerRecordId: input.providerRecordId,
    }),
    reviewState: "clear",
  });

  await input.repositories.gmailMessageDetails.upsert({
    sourceEvidenceId: input.sourceEvidenceId,
    providerRecordId: input.providerRecordId,
    gmailThreadId: `thread:${input.providerRecordId}`,
    rfc822MessageId: `<${input.providerRecordId}@example.org>`,
    direction: "inbound",
    subject: `Subject ${input.providerRecordId}`,
    fromHeader: input.fromHeader ?? null,
    toHeader: input.toHeader ?? null,
    ccHeader: input.ccHeader ?? null,
    fromEmails: [],
    toEmails: [],
    ccEmails: [],
    bccEmails: [],
    labelIds: ["INBOX"],
    snippetClean: "Snippet",
    bodyTextPreview: "Preview",
    bodyKind: "plaintext",
    capturedMailbox: "volunteers@adventurescientists.org",
    projectInboxAlias: null,
  });
}

async function addAudienceRow(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly canonicalEventId: string;
  readonly contactId: string;
  readonly email: string;
}): Promise<void> {
  await input.context.db.insert(canonicalEventAudience).values({
    canonicalEventId: input.canonicalEventId,
    contactId: input.contactId,
    participantRole: "direct_recipient",
    normalizedEmail: input.email,
  });
}

async function readContactDisplayName(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>,
  contactId: string,
): Promise<string | null> {
  const [row] = await context.db
    .select({
      displayName: contacts.displayName,
    })
    .from(contacts)
    .where(eq(contacts.id, contactId));

  return row?.displayName ?? null;
}

function createLogger(logs: BackfillContactDisplayNamesLogEntry[]) {
  return {
    log(value: unknown) {
      if (typeof value === "string" && value.startsWith("{")) {
        logs.push(JSON.parse(value) as BackfillContactDisplayNamesLogEntry);
      }
    },
    error() {
      return undefined;
    },
  };
}

describe("backfill-contact-display-names", () => {
  it("logs a planned update in dry-run mode without writing the contact", async () => {
    const context = await createTestWorkerContext();
    const logs: BackfillContactDisplayNamesLogEntry[] = [];

    try {
      await seedContact({
        repositories: context.repositories,
        id: "contact:target",
        primaryEmail: "or-rural-coordinator@example.org",
        displayName: "or-rural-coordinator@example.org",
      });
      await seedGmailEvent({
        repositories: context.repositories,
        canonicalEventId: "event:target",
        sourceEvidenceId: "source:target",
        providerRecordId: "gmail-target",
        contactId: "contact:target",
        occurredAt: "2026-05-20T10:00:00.000Z",
        fromHeader:
          '"Scotty Stalp" <or-rural-coordinator@example.org>',
      });

      const result = await backfillContactDisplayNames({
        db: context.db,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: false,
        limit: 100,
        logger: createLogger(logs),
      });

      expect(result).toMatchObject({
        dryRun: true,
        candidates: 1,
        updated: 1,
        skipped: 0,
      });
      await expect(readContactDisplayName(context, "contact:target")).resolves.toBe(
        "or-rural-coordinator@example.org",
      );
      expect(logs).toContainEqual({
        action: "dryRun",
        contactId: "contact:target",
        primaryEmail: "or-rural-coordinator@example.org",
        displayName: "Scotty Stalp",
        dryRun: true,
      });
    } finally {
      await context.dispose();
    }
  });

  it("updates the contact when execute=true and the match is found through audience rows", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        repositories: context.repositories,
        id: "contact:target",
        primaryEmail: "alice@example.org",
        displayName: "alice@example.org",
      });
      await seedContact({
        repositories: context.repositories,
        id: "contact:anchor",
        primaryEmail: "anchor@example.org",
        displayName: "Anchor",
      });
      await seedGmailEvent({
        repositories: context.repositories,
        canonicalEventId: "event:audience",
        sourceEvidenceId: "source:audience",
        providerRecordId: "gmail-audience",
        contactId: "contact:anchor",
        occurredAt: "2026-05-21T10:00:00.000Z",
        toHeader: '"Alice Example" <alice@example.org>',
      });
      await addAudienceRow({
        context,
        canonicalEventId: "event:audience",
        contactId: "contact:target",
        email: "alice@example.org",
      });

      const result = await backfillContactDisplayNames({
        db: context.db,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: true,
        limit: 100,
      });

      expect(result).toMatchObject({
        dryRun: false,
        candidates: 1,
        updated: 1,
        skipped: 0,
      });
      await expect(readContactDisplayName(context, "contact:target")).resolves.toBe(
        "Alice Example",
      );
    } finally {
      await context.dispose();
    }
  });

  it("skips contacts with no matching header anywhere", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        repositories: context.repositories,
        id: "contact:no-match",
        primaryEmail: "nomatch@example.org",
        displayName: "nomatch@example.org",
      });
      await seedGmailEvent({
        repositories: context.repositories,
        canonicalEventId: "event:no-match",
        sourceEvidenceId: "source:no-match",
        providerRecordId: "gmail-no-match",
        contactId: "contact:no-match",
        occurredAt: "2026-05-22T10:00:00.000Z",
        fromHeader: '"Someone Else" <someone@example.org>',
      });

      const result = await backfillContactDisplayNames({
        db: context.db,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: false,
        limit: 100,
      });

      expect(result).toMatchObject({
        updated: 0,
        skipped: 1,
        byReason: {
          no_header_match: 1,
          no_display_name_in_header: 0,
          display_name_equals_email_local_part: 0,
        },
      });
    } finally {
      await context.dispose();
    }
  });

  it("skips contacts when the matching header is bare-email only", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        repositories: context.repositories,
        id: "contact:bare",
        primaryEmail: "bare@example.org",
        displayName: "bare@example.org",
      });
      await seedGmailEvent({
        repositories: context.repositories,
        canonicalEventId: "event:bare",
        sourceEvidenceId: "source:bare",
        providerRecordId: "gmail-bare",
        contactId: "contact:bare",
        occurredAt: "2026-05-23T10:00:00.000Z",
        fromHeader: "bare@example.org",
      });

      const result = await backfillContactDisplayNames({
        db: context.db,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: false,
        limit: 100,
      });

      expect(result.byReason.no_display_name_in_header).toBe(1);
    } finally {
      await context.dispose();
    }
  });

  it("skips contacts when the observed display name only repeats the local part", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        repositories: context.repositories,
        id: "contact:local-part",
        primaryEmail: "or-rural-coordinator@example.org",
        displayName: "or-rural-coordinator@example.org",
      });
      await seedGmailEvent({
        repositories: context.repositories,
        canonicalEventId: "event:local-part",
        sourceEvidenceId: "source:local-part",
        providerRecordId: "gmail-local-part",
        contactId: "contact:local-part",
        occurredAt: "2026-05-24T10:00:00.000Z",
        fromHeader:
          '"or-rural-coordinator" <or-rural-coordinator@example.org>',
      });

      const result = await backfillContactDisplayNames({
        db: context.db,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: false,
        limit: 100,
      });

      expect(result.byReason.display_name_equals_email_local_part).toBe(1);
    } finally {
      await context.dispose();
    }
  });

  it("is idempotent after applying a display-name update", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        repositories: context.repositories,
        id: "contact:idempotent",
        primaryEmail: "idempotent@example.org",
        displayName: "idempotent@example.org",
      });
      await seedGmailEvent({
        repositories: context.repositories,
        canonicalEventId: "event:idempotent",
        sourceEvidenceId: "source:idempotent",
        providerRecordId: "gmail-idempotent",
        contactId: "contact:idempotent",
        occurredAt: "2026-05-25T10:00:00.000Z",
        fromHeader: '"Ida Potent" <idempotent@example.org>',
      });

      const first = await backfillContactDisplayNames({
        db: context.db,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: true,
        limit: 100,
      });
      const second = await backfillContactDisplayNames({
        db: context.db,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: true,
        limit: 100,
      });

      expect(first.updated).toBe(1);
      expect(second.candidates).toBe(0);
      expect(second.updated).toBe(0);
    } finally {
      await context.dispose();
    }
  });

  it("leaves already-named contacts out of the candidate set", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        repositories: context.repositories,
        id: "contact:already-named",
        primaryEmail: "named@example.org",
        displayName: "Already Named",
      });

      const result = await backfillContactDisplayNames({
        db: context.db,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-31T23:59:59.999Z",
        execute: false,
        limit: 100,
      });

      expect(result.candidates).toBe(0);
    } finally {
      await context.dispose();
    }
  });
});
