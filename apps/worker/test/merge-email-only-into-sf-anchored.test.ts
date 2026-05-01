import { describe, expect, it } from "vitest";

import {
  contactTimelineProjection,
  type Stage1Database,
} from "@as-comms/db";
import { sql } from "drizzle-orm";

import { createTestStage1Context } from "./helpers.js";
import {
  applyMergeForPair,
  loadDupePairs,
  planMergeForPair,
} from "../src/ops/merge-email-only-into-sf-anchored.js";

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
}

function buildSqlRunner(db: Stage1Database): SqlRunner {
  return {
    async unsafe<T extends readonly object[]>(query: string): Promise<T> {
      const result = await db.execute(sql.raw(query));
      return Array.isArray(result)
        ? (result as unknown as T)
        : (result as { readonly rows: T }).rows;
    },
  };
}

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
      providerThreadId: "gmail-thread-1",
    },
    direction: "inbound" as const,
    notes: null,
  };
}

async function seedContact(
  db: Awaited<ReturnType<typeof createTestStage1Context>>["repositories"],
  input: {
    readonly id: string;
    readonly salesforceContactId: string | null;
    readonly displayName: string;
    readonly primaryEmail: string | null;
  },
): Promise<void> {
  await db.contacts.upsert({
    id: input.id,
    salesforceContactId: input.salesforceContactId,
    displayName: input.displayName,
    primaryEmail: input.primaryEmail,
    primaryPhone: null,
    createdAt: "2026-05-02T01:00:00.000Z",
    updatedAt: "2026-05-02T01:00:00.000Z",
  });
}

async function seedMergePair(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
): Promise<{
  readonly emailOnlyId: string;
  readonly sfAnchoredId: string;
}> {
  const emailOnlyId = "contact:email:dupe@example.org";
  const sfAnchoredId = "contact:salesforce:003DUPE";

  await seedContact(context.repositories, {
    id: emailOnlyId,
    salesforceContactId: null,
    displayName: "Email Only",
    primaryEmail: "dupe@example.org",
  });
  await seedContact(context.repositories, {
    id: sfAnchoredId,
    salesforceContactId: "003DUPE",
    displayName: "Salesforce Contact",
    primaryEmail: "dupe@example.org",
  });

  await context.repositories.sourceEvidence.append({
    id: "source-evidence:gmail:message:dupe-1",
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: "dupe-1",
    receivedAt: "2026-05-02T01:01:00.000Z",
    occurredAt: "2026-05-02T01:01:00.000Z",
    payloadRef: "gmail://message/dupe-1",
    idempotencyKey: "source-evidence:gmail:message:dupe-1",
    checksum: "checksum:dupe-1",
  });
  await context.repositories.sourceEvidence.append({
    id: "source-evidence:gmail:message:dupe-case-1",
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: "dupe-case-1",
    receivedAt: "2026-05-02T01:02:00.000Z",
    occurredAt: "2026-05-02T01:02:00.000Z",
    payloadRef: "gmail://message/dupe-case-1",
    idempotencyKey: "source-evidence:gmail:message:dupe-case-1",
    checksum: "checksum:dupe-case-1",
  });
  await context.repositories.sourceEvidence.append({
    id: "source-evidence:gmail:message:dupe-case-2",
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: "dupe-case-2",
    receivedAt: "2026-05-02T01:03:00.000Z",
    occurredAt: "2026-05-02T01:03:00.000Z",
    payloadRef: "gmail://message/dupe-case-2",
    idempotencyKey: "source-evidence:gmail:message:dupe-case-2",
    checksum: "checksum:dupe-case-2",
  });

  await context.repositories.canonicalEvents.upsert({
    id: "canonical-event:dupe-1",
    contactId: emailOnlyId,
    eventType: "communication.email.inbound",
    channel: "email",
    occurredAt: "2026-05-02T01:01:00.000Z",
    contentFingerprint: null,
    sourceEvidenceId: "source-evidence:gmail:message:dupe-1",
    idempotencyKey: "canonical-event:dupe-1",
    provenance: buildCanonicalProvenance({
      sourceEvidenceId: "source-evidence:gmail:message:dupe-1",
      providerRecordId: "dupe-1",
    }),
    reviewState: "clear",
  });

  await context.db.insert(contactTimelineProjection).values({
    id: "timeline:dupe-1",
    contactId: emailOnlyId,
    canonicalEventId: "canonical-event:dupe-1",
    occurredAt: new Date("2026-05-02T01:01:00.000Z"),
    sortKey: "2026-05-02T01:01:00.000Z#canonical-event:dupe-1",
    eventType: "communication.email.inbound",
    summary: "Inbound email",
    channel: "email",
    primaryProvider: "gmail",
    reviewState: "clear",
  });

  await context.repositories.identityResolutionQueue.upsert({
    id: "identity-review:dupe-anchored",
    sourceEvidenceId: "source-evidence:gmail:message:dupe-case-1",
    candidateContactIds: [emailOnlyId],
    reasonCode: "identity_anchor_mismatch",
    status: "open",
    openedAt: "2026-05-02T01:02:00.000Z",
    resolvedAt: null,
    normalizedIdentityValues: ["dupe@example.org"],
    anchoredContactId: emailOnlyId,
    explanation: "Anchor mismatch before cleanup.",
  });
  await context.repositories.identityResolutionQueue.upsert({
    id: "identity-review:dupe-candidate",
    sourceEvidenceId: "source-evidence:gmail:message:dupe-case-2",
    candidateContactIds: [emailOnlyId, sfAnchoredId],
    reasonCode: "identity_multi_candidate",
    status: "open",
    openedAt: "2026-05-02T01:03:00.000Z",
    resolvedAt: null,
    normalizedIdentityValues: ["dupe@example.org"],
    anchoredContactId: null,
    explanation: "Multiple candidates before cleanup.",
  });

  return {
    emailOnlyId,
    sfAnchoredId,
  };
}

async function selectRows<TRow extends readonly object[]>(
  db: Stage1Database,
  query: ReturnType<typeof sql<unknown>>,
): Promise<TRow> {
  const result = await db.execute(query);
  return Array.isArray(result)
    ? (result as unknown as TRow)
    : (result as { readonly rows: TRow }).rows;
}

function requireValue<TValue>(
  value: TValue | undefined,
  message: string,
): TValue {
  if (value === undefined) {
    throw new Error(message);
  }

  return value;
}

describe("merge-email-only-into-sf-anchored", () => {
  it("loads only email-only to Salesforce duplicate pairs", async () => {
    const context = await createTestStage1Context();

    try {
      await seedContact(context.repositories, {
        id: "contact:email:dupe@example.org",
        salesforceContactId: null,
        displayName: "Email Only",
        primaryEmail: "dupe@example.org",
      });
      await seedContact(context.repositories, {
        id: "contact:salesforce:003DUPE",
        salesforceContactId: "003DUPE",
        displayName: "Salesforce Contact",
        primaryEmail: "dupe@example.org",
      });
      await seedContact(context.repositories, {
        id: "contact:email:no-match@example.org",
        salesforceContactId: null,
        displayName: "No Match",
        primaryEmail: "no-match@example.org",
      });
      await seedContact(context.repositories, {
        id: "contact:salesforce:003SOLO",
        salesforceContactId: "003SOLO",
        displayName: "Solo Salesforce",
        primaryEmail: "solo@example.org",
      });

      await expect(loadDupePairs(buildSqlRunner(context.db))).resolves.toEqual([
        {
          emailOnlyId: "contact:email:dupe@example.org",
          sfAnchoredId: "contact:salesforce:003DUPE",
          primaryEmail: "dupe@example.org",
        },
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("does not mutate the database in dry-run mode", async () => {
    const context = await createTestStage1Context();

    try {
      const pairIds = await seedMergePair(context);
      const sqlRunner = buildSqlRunner(context.db);
      const pair = (
        await loadDupePairs(sqlRunner)
      ).find((entry) => entry.emailOnlyId === pairIds.emailOnlyId);

      const targetPair = requireValue(
        pair,
        `Expected dupe pair for ${pairIds.emailOnlyId}.`,
      );

      const plan = await planMergeForPair({
        pair: targetPair,
        sql: sqlRunner,
      });
      const result = await applyMergeForPair({
        db: context.db,
        pair: targetPair,
        plan,
        dryRun: true,
      });

      expect(result).toMatchObject({
        canonicalEventsRepointed: 1,
        timelineRowsRepointed: 1,
        identityCasesResolved: 2,
        contactsDeleted: 1,
      });

      await expect(
        context.repositories.contacts.findById(pairIds.emailOnlyId),
      ).resolves.not.toBeNull();
      await expect(
        selectRows<
          readonly {
            readonly contactId: string;
          }[]
        >(
          context.db,
          sql`
            select contact_id as "contactId"
            from canonical_event_ledger
            where id = 'canonical-event:dupe-1'
          `,
        ),
      ).resolves.toEqual([{ contactId: pairIds.emailOnlyId }]);
      await expect(
        selectRows<
          readonly {
            readonly status: string;
            readonly anchoredContactId: string | null;
          }[]
        >(
          context.db,
          sql`
            select
              status,
              anchored_contact_id as "anchoredContactId"
            from identity_resolution_queue
            where id = 'identity-review:dupe-anchored'
          `,
        ),
      ).resolves.toEqual([
        {
          status: "open",
          anchoredContactId: pairIds.emailOnlyId,
        },
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("repoints dependent rows, resolves queue cases, and deletes the email-only contact in execute mode", async () => {
    const context = await createTestStage1Context();

    try {
      const pairIds = await seedMergePair(context);
      const sqlRunner = buildSqlRunner(context.db);
      const pair = (
        await loadDupePairs(sqlRunner)
      ).find((entry) => entry.emailOnlyId === pairIds.emailOnlyId);

      const targetPair = requireValue(
        pair,
        `Expected dupe pair for ${pairIds.emailOnlyId}.`,
      );

      const plan = await planMergeForPair({
        pair: targetPair,
        sql: sqlRunner,
      });

      await expect(
        applyMergeForPair({
          db: context.db,
          pair: targetPair,
          plan,
          dryRun: false,
        }),
      ).resolves.toMatchObject({
        canonicalEventsRepointed: 1,
        timelineRowsRepointed: 1,
        identityCasesResolved: 2,
        contactsDeleted: 1,
      });

      await expect(
        selectRows<
          readonly {
            readonly contactId: string;
          }[]
        >(
          context.db,
          sql`
            select contact_id as "contactId"
            from canonical_event_ledger
            where id = 'canonical-event:dupe-1'
          `,
        ),
      ).resolves.toEqual([{ contactId: pairIds.sfAnchoredId }]);
      await expect(
        selectRows<
          readonly {
            readonly contactId: string;
          }[]
        >(
          context.db,
          sql`
            select contact_id as "contactId"
            from contact_timeline_projection
            where id = 'timeline:dupe-1'
          `,
        ),
      ).resolves.toEqual([{ contactId: pairIds.sfAnchoredId }]);

      const queueRows = await selectRows<
        readonly {
          readonly id: string;
          readonly status: string;
          readonly anchoredContactId: string | null;
          readonly candidateContactIds: readonly string[];
          readonly explanation: string;
        }[]
      >(
        context.db,
        sql`
          select
            id,
            status,
            anchored_contact_id as "anchoredContactId",
            candidate_contact_ids as "candidateContactIds",
            explanation
          from identity_resolution_queue
          where id in ('identity-review:dupe-anchored', 'identity-review:dupe-candidate')
          order by id
        `,
      );

      expect(queueRows).toHaveLength(2);
      expect(queueRows[0]).toMatchObject({
        id: "identity-review:dupe-anchored",
        status: "resolved",
        anchoredContactId: pairIds.sfAnchoredId,
        candidateContactIds: [pairIds.sfAnchoredId],
      });
      expect(queueRows[0]?.explanation).toContain(
        `merged duplicate contact ${pairIds.emailOnlyId} into ${pairIds.sfAnchoredId} (architect cleanup 2026-05-02)`,
      );
      expect(queueRows[1]).toMatchObject({
        id: "identity-review:dupe-candidate",
        status: "resolved",
        anchoredContactId: null,
        candidateContactIds: [pairIds.sfAnchoredId],
      });
      expect(queueRows[1]?.explanation).toContain(
        `merged duplicate contact ${pairIds.emailOnlyId} into ${pairIds.sfAnchoredId} (architect cleanup 2026-05-02)`,
      );

      await expect(
        context.repositories.contacts.findById(pairIds.emailOnlyId),
      ).resolves.toBeNull();
    } finally {
      await context.dispose();
    }
  });
});
