import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

async function seedUser(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
  input: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
  },
): Promise<void> {
  const now = new Date("2026-04-21T12:00:00.000Z");

  await context.settings.users.upsert({
    id: input.id,
    name: input.name,
    email: input.email,
    emailVerified: now,
    image: null,
    role: "operator",
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedManualNote(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
  input: {
    readonly noteId: string;
    readonly contactId: string;
    readonly authorId: string;
    readonly body?: string;
  },
): Promise<{
  readonly sourceEvidenceId: string;
  readonly canonicalEventId: string;
}> {
  const occurredAt = "2026-04-21T12:00:00.000Z";
  const sourceEvidenceId = `source-evidence:manual:note:${input.noteId}`;
  const canonicalEventId = `canonical-event:manual:note:${input.noteId}`;

  await context.repositories.contacts.upsert({
    id: input.contactId,
    salesforceContactId: null,
    displayName: "Timeline Contact",
    primaryEmail: "timeline@example.org",
    primaryPhone: null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "manual",
    providerRecordType: "note",
    providerRecordId: input.noteId,
    receivedAt: occurredAt,
    occurredAt,
    payloadRef: `manual://note/${input.noteId}`,
    idempotencyKey: `manual:note:${input.noteId}`,
    checksum: `checksum:${input.noteId}`,
  });

  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType: "note.internal.created",
    channel: "note",
    occurredAt,
    contentFingerprint: null,
    sourceEvidenceId,
    idempotencyKey: `canonical-event:manual:note:${input.noteId}`,
    provenance: {
      primaryProvider: "manual",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "note",
      sourceRecordId: input.noteId,
      messageKind: null,
      campaignRef: null,
      threadRef: null,
      direction: null,
      notes: null,
    },
    reviewState: "clear",
  });

  await context.repositories.timelineProjection.upsert({
    id: `timeline:${input.noteId}`,
    contactId: input.contactId,
    canonicalEventId,
    occurredAt,
    sortKey: `${occurredAt}::${canonicalEventId}`,
    eventType: "note.internal.created",
    summary: "Internal note added",
    channel: "note",
    primaryProvider: "manual",
    reviewState: "clear",
  });

  await context.repositories.manualNoteDetails.upsert({
    sourceEvidenceId,
    providerRecordId: input.noteId,
    body: input.body ?? "Original note body",
    authorDisplayName: "Author",
    authorId: input.authorId,
  });

  return {
    sourceEvidenceId,
    canonicalEventId,
  };
}

describe("manual note author repository guards", () => {
  it("persists authorId on upsert", async () => {
    const context = await createTestStage1Context();
    await seedUser(context, {
      id: "user:author",
      email: "author@example.org",
      name: "Author",
    });

    const { sourceEvidenceId } = await seedManualNote(context, {
      noteId: "note-1",
      contactId: "contact:one",
      authorId: "user:author",
    });

    await expect(
      context.repositories.manualNoteDetails.listBySourceEvidenceIds([
        sourceEvidenceId,
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceEvidenceId,
        authorId: "user:author",
      }),
    ]);
  });

  it("updates the body only when the author id matches", async () => {
    const context = await createTestStage1Context();
    await seedUser(context, {
      id: "user:author",
      email: "author@example.org",
      name: "Author",
    });
    await seedUser(context, {
      id: "user:other",
      email: "other@example.org",
      name: "Other",
    });

    const { sourceEvidenceId } = await seedManualNote(context, {
      noteId: "note-2",
      contactId: "contact:two",
      authorId: "user:author",
    });

    await expect(
      context.repositories.manualNoteDetails.updateBody({
        sourceEvidenceId,
        authorId: "user:author",
        body: "Updated note body",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        sourceEvidenceId,
        body: "Updated note body",
      }),
    );

    await expect(
      context.repositories.manualNoteDetails.updateBody({
        sourceEvidenceId,
        authorId: "user:other",
        body: "Should not apply",
      }),
    ).resolves.toBeNull();
  });

  it("deletes authored notes only for the matching author and cascades note records", async () => {
    const context = await createTestStage1Context();
    await seedUser(context, {
      id: "user:author",
      email: "author@example.org",
      name: "Author",
    });
    await seedUser(context, {
      id: "user:other",
      email: "other@example.org",
      name: "Other",
    });

    const { sourceEvidenceId, canonicalEventId } = await seedManualNote(
      context,
      {
        noteId: "note-3",
        contactId: "contact:three",
        authorId: "user:author",
      },
    );

    await expect(
      context.repositories.manualNoteDetails.deleteByAuthor({
        sourceEvidenceId,
        authorId: "user:other",
      }),
    ).resolves.toBe(0);

    await expect(
      context.repositories.manualNoteDetails.deleteByAuthor({
        sourceEvidenceId,
        authorId: "user:author",
      }),
    ).resolves.toBe(1);

    await expect(
      context.repositories.sourceEvidence.findById(sourceEvidenceId),
    ).resolves.toBeNull();
    await expect(
      context.repositories.canonicalEvents.findById(canonicalEventId),
    ).resolves.toBeNull();
    await expect(
      context.repositories.timelineProjection.findByCanonicalEventId(
        canonicalEventId,
      ),
    ).resolves.toBeNull();
  });
});
