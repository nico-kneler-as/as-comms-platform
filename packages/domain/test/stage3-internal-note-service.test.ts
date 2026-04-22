import { describe, expect, it, vi } from "vitest";

import type {
  CanonicalEventRecord,
  InboxProjectionRow,
  ManualNoteDetailRecord,
  SourceEvidenceRecord,
  TimelineProjectionRow,
} from "@as-comms/contracts";

import { createStage1InternalNoteService } from "../src/notes.js";

function buildContact() {
  return {
    id: "contact:one",
    salesforceContactId: null,
    displayName: "One Contact",
    primaryEmail: "contact@example.org",
    primaryPhone: null,
    createdAt: "2026-04-21T12:00:00.000Z",
    updatedAt: "2026-04-21T12:00:00.000Z",
  };
}

describe("Stage1InternalNoteService", () => {
  it("passes authorId through createNote", async () => {
    const upsertManualNoteDetail = vi.fn((record: ManualNoteDetailRecord) =>
      Promise.resolve(record),
    );

    const service = createStage1InternalNoteService({
      persistence: {
        repositories: {
          contacts: {
            findById: vi.fn(() => Promise.resolve(buildContact())),
          },
          sourceEvidence: {
            findById: vi.fn(() => Promise.resolve(null)),
          },
          canonicalEvents: {
            findById: vi.fn(() => Promise.resolve(null)),
          },
          manualNoteDetails: {
            listBySourceEvidenceIds: vi.fn(() => Promise.resolve([])),
            updateBody: vi.fn(() => Promise.resolve(null)),
            deleteByAuthor: vi.fn(() => Promise.resolve(0)),
          },
        },
        recordSourceEvidence: vi.fn(
          (record: SourceEvidenceRecord) =>
            ({ outcome: "inserted", record }) as const,
        ),
        persistCanonicalEvent: vi.fn(
          (record: CanonicalEventRecord) =>
            ({ outcome: "inserted", record }) as const,
        ),
        upsertManualNoteDetail,
      } as never,
      normalization: {
        applyTimelineProjection: vi.fn(
          async (_input: unknown): Promise<TimelineProjectionRow> =>
            ({
              id: "timeline:note-1",
              contactId: "contact:one",
              canonicalEventId: "canonical-event:manual:note:note-1",
              occurredAt: "2026-04-21T12:00:00.000Z",
              sortKey:
                "2026-04-21T12:00:00.000Z::canonical-event:manual:note:note-1",
              eventType: "note.internal.created",
              summary: "Internal note added",
              channel: "note",
              primaryProvider: "manual",
              reviewState: "clear",
            }) satisfies TimelineProjectionRow,
        ),
        refreshInboxReviewOverlay: vi.fn(() =>
          Promise.resolve(null as InboxProjectionRow | null),
        ),
      },
    });

    await service.createNote({
      noteId: "note-1",
      contactId: "contact:one",
      body: "Author-owned note",
      occurredAt: "2026-04-21T12:00:00.000Z",
      authorDisplayName: "Operator",
      authorId: "user:author",
    });

    expect(upsertManualNoteDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: "user:author",
      }),
    );
  });

  it("returns not_authorized when a non-author tries to update a note", async () => {
    const service = createStage1InternalNoteService({
      persistence: {
        repositories: {
          contacts: {
            findById: vi.fn(() => Promise.resolve(buildContact())),
          },
          sourceEvidence: {
            findById: vi.fn(
              () =>
                ({
                  id: "source-evidence:manual:note:note-2",
                  provider: "manual",
                  providerRecordType: "note",
                  providerRecordId: "note-2",
                  receivedAt: "2026-04-21T12:00:00.000Z",
                  occurredAt: "2026-04-21T12:00:00.000Z",
                  payloadRef: "manual://note/note-2",
                  idempotencyKey: "manual:note:note-2",
                  checksum: "checksum-note-2",
                }) satisfies SourceEvidenceRecord,
            ),
          },
          canonicalEvents: {
            findById: vi.fn(() => Promise.resolve(null)),
          },
          manualNoteDetails: {
            listBySourceEvidenceIds: vi.fn(
              () =>
                [
                  {
                    sourceEvidenceId: "source-evidence:manual:note:note-2",
                    providerRecordId: "note-2",
                    body: "Original",
                    authorDisplayName: "Author",
                    authorId: "user:author",
                  },
                ] satisfies ManualNoteDetailRecord[],
            ),
            updateBody: vi.fn(() => Promise.resolve(null)),
            deleteByAuthor: vi.fn(() => Promise.resolve(0)),
          },
        },
      } as never,
      normalization: {
        applyTimelineProjection: vi.fn(),
        refreshInboxReviewOverlay: vi.fn(() => Promise.resolve(null)),
      },
    });

    await expect(
      service.updateNote({
        noteId: "note-2",
        authorId: "user:other",
        body: "Updated",
      }),
    ).resolves.toEqual({
      outcome: "not_authorized",
    });
  });

  it("returns not_authorized when a non-author tries to delete a note", async () => {
    const service = createStage1InternalNoteService({
      persistence: {
        repositories: {
          contacts: {
            findById: vi.fn(() => Promise.resolve(buildContact())),
          },
          sourceEvidence: {
            findById: vi.fn(
              () =>
                ({
                  id: "source-evidence:manual:note:note-3",
                  provider: "manual",
                  providerRecordType: "note",
                  providerRecordId: "note-3",
                  receivedAt: "2026-04-21T12:00:00.000Z",
                  occurredAt: "2026-04-21T12:00:00.000Z",
                  payloadRef: "manual://note/note-3",
                  idempotencyKey: "manual:note:note-3",
                  checksum: "checksum-note-3",
                }) satisfies SourceEvidenceRecord,
            ),
          },
          canonicalEvents: {
            findById: vi.fn(
              () =>
                ({
                  id: "canonical-event:manual:note:note-3",
                  contactId: "contact:one",
                  eventType: "note.internal.created",
                  channel: "note",
                  occurredAt: "2026-04-21T12:00:00.000Z",
                  sourceEvidenceId: "source-evidence:manual:note:note-3",
                  idempotencyKey: "canonical-event:manual:note:note-3",
                  contentFingerprint: null,
                  provenance: {
                    primaryProvider: "manual",
                    primarySourceEvidenceId:
                      "source-evidence:manual:note:note-3",
                    supportingSourceEvidenceIds: [],
                    winnerReason: "single_source",
                    sourceRecordType: "note",
                    sourceRecordId: "note-3",
                    messageKind: null,
                    campaignRef: null,
                    threadRef: null,
                    direction: null,
                    notes: null,
                  },
                  reviewState: "clear",
                }) satisfies CanonicalEventRecord,
            ),
          },
          manualNoteDetails: {
            listBySourceEvidenceIds: vi.fn(
              () =>
                [
                  {
                    sourceEvidenceId: "source-evidence:manual:note:note-3",
                    providerRecordId: "note-3",
                    body: "Original",
                    authorDisplayName: "Author",
                    authorId: "user:author",
                  },
                ] satisfies ManualNoteDetailRecord[],
            ),
            updateBody: vi.fn(() => Promise.resolve(null)),
            deleteByAuthor: vi.fn(() => Promise.resolve(0)),
          },
        },
      } as never,
      normalization: {
        applyTimelineProjection: vi.fn(),
        refreshInboxReviewOverlay: vi.fn(() => Promise.resolve(null)),
      },
    });

    await expect(
      service.deleteNote({
        noteId: "note-3",
        authorId: "user:other",
      }),
    ).resolves.toEqual({
      outcome: "not_authorized",
    });
  });
});
