import { describe, expect, it, vi } from "vitest";

import { createStage1InternalNoteService } from "../src/notes.js";
import type {
  InternalNoteRecord,
  InternalNoteRepository,
} from "../src/repositories.js";

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

function createHarness() {
  const notes = new Map<string, InternalNoteRecord>();
  let timestamp = Date.parse("2026-04-21T12:00:00.000Z");

  const recordSourceEvidence = vi.fn();
  const persistCanonicalEvent = vi.fn();
  const upsertManualNoteDetail = vi.fn();
  const applyTimelineProjection = vi.fn();
  const refreshInboxReviewOverlay = vi.fn();

  const service = createStage1InternalNoteService({
    persistence: {
      repositories: {
        contacts: {
          findById: vi.fn(() => Promise.resolve(buildContact())),
        },
        internalNotes: {
          create: vi.fn((input: Parameters<InternalNoteRepository["create"]>[0]) => {
            const createdAt = input.createdAt ?? new Date((timestamp += 1_000));
            const updatedAt = input.updatedAt ?? createdAt;
            const record: InternalNoteRecord = {
              id: input.id,
              contactId: input.contactId,
              body: input.body,
              authorDisplayName:
                input.authorId === "user:author" ? "Author User" : null,
              authorId: input.authorId,
              createdAt,
              updatedAt,
            };
            notes.set(record.id, record);
            return Promise.resolve(record);
          }),
          findById: vi.fn((id: string) => Promise.resolve(notes.get(id))),
          findByContactId: vi.fn((contactId: string) =>
            Promise.resolve(
              [...notes.values()].filter((note) => note.contactId === contactId),
            ),
          ),
          update: vi.fn((input: Parameters<InternalNoteRepository["update"]>[0]) => {
            const existing = notes.get(input.id);
            if (existing === undefined) {
              throw new Error(`Missing note ${input.id}`);
            }

            const updated: InternalNoteRecord = {
              ...existing,
              body: input.body,
              updatedAt: input.updatedAt ?? new Date((timestamp += 1_000)),
            };
            notes.set(updated.id, updated);
            return Promise.resolve(updated);
          }),
          delete: vi.fn((id: string) => {
            notes.delete(id);
            return Promise.resolve();
          }),
        },
      },
      recordSourceEvidence,
      persistCanonicalEvent,
      upsertManualNoteDetail,
    } as never,
    normalization: {
      applyTimelineProjection,
      refreshInboxReviewOverlay,
    },
  });

  return {
    notes,
    recordSourceEvidence,
    persistCanonicalEvent,
    upsertManualNoteDetail,
    applyTimelineProjection,
    refreshInboxReviewOverlay,
    service,
  };
}

describe("Stage1InternalNoteService", () => {
  it("creates a single internal_notes row and returns it without legacy writes", async () => {
    const harness = createHarness();

    const result = await harness.service.createNote({
      noteId: "note-1",
      contactId: "contact:one",
      body: "Author-owned note",
      occurredAt: "2026-04-21T12:00:00.000Z",
      authorDisplayName: "Author User",
      authorId: "user:author",
    });

    expect(result).toMatchObject({
      outcome: "applied",
      note: {
        id: "note-1",
        contactId: "contact:one",
        body: "Author-owned note",
        authorId: "user:author",
      },
    });
    expect(harness.notes.get("note-1")).toMatchObject({
      id: "note-1",
      body: "Author-owned note",
    });
    expect(harness.recordSourceEvidence).not.toHaveBeenCalled();
    expect(harness.persistCanonicalEvent).not.toHaveBeenCalled();
    expect(harness.upsertManualNoteDetail).not.toHaveBeenCalled();
    expect(harness.applyTimelineProjection).not.toHaveBeenCalled();
    expect(harness.refreshInboxReviewOverlay).not.toHaveBeenCalled();
  });

  it("is idempotent on noteId", async () => {
    const harness = createHarness();

    await harness.service.createNote({
      noteId: "note-1",
      contactId: "contact:one",
      body: "First body",
      occurredAt: "2026-04-21T12:00:00.000Z",
      authorId: "user:author",
    });

    await expect(
      harness.service.createNote({
        noteId: "note-1",
        contactId: "contact:one",
        body: "Second body",
        occurredAt: "2026-04-21T12:05:00.000Z",
        authorId: "user:author",
      }),
    ).resolves.toMatchObject({
      outcome: "duplicate",
      note: {
        id: "note-1",
        body: "First body",
      },
    });
  });

  it("enforces author-only updates", async () => {
    const harness = createHarness();

    await harness.service.createNote({
      noteId: "note-2",
      contactId: "contact:one",
      body: "Original",
      occurredAt: "2026-04-21T12:00:00.000Z",
      authorId: "user:author",
    });

    await expect(
      harness.service.updateNote({
        noteId: "note-2",
        authorId: "user:other",
        body: "Updated",
      }),
    ).resolves.toEqual({
      outcome: "not_authorized",
    });
  });

  it("bumps updatedAt when an update applies", async () => {
    const harness = createHarness();

    const created = await harness.service.createNote({
      noteId: "note-3",
      contactId: "contact:one",
      body: "Before",
      occurredAt: "2026-04-21T12:00:00.000Z",
      authorId: "user:author",
    });

    await expect(
      harness.service.updateNote({
        noteId: "note-3",
        authorId: "user:author",
        body: "After",
      }),
    ).resolves.toEqual({
      outcome: "applied",
    });

    const updated = harness.notes.get("note-3");
    expect(updated?.body).toBe("After");
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(
      created.note.updatedAt.getTime(),
    );
  });

  it("deletes a note for the author", async () => {
    const harness = createHarness();

    await harness.service.createNote({
      noteId: "note-4",
      contactId: "contact:one",
      body: "Delete me",
      occurredAt: "2026-04-21T12:00:00.000Z",
      authorId: "user:author",
    });

    await expect(
      harness.service.deleteNote({
        noteId: "note-4",
        authorId: "user:author",
      }),
    ).resolves.toEqual({
      outcome: "applied",
    });
    expect(harness.notes.has("note-4")).toBe(false);
  });

  it("returns not_authorized when a non-author non-admin deletes a note", async () => {
    const harness = createHarness();

    await harness.service.createNote({
      noteId: "note-5",
      contactId: "contact:one",
      body: "Protected",
      occurredAt: "2026-04-21T12:00:00.000Z",
      authorId: "user:author",
    });

    await expect(
      harness.service.deleteNote({
        noteId: "note-5",
        authorId: "user:other",
      }),
    ).resolves.toEqual({
      outcome: "not_authorized",
    });
  });

  it("allows admins to delete another author's note", async () => {
    const harness = createHarness();

    await harness.service.createNote({
      noteId: "note-6",
      contactId: "contact:one",
      body: "Admin removable",
      occurredAt: "2026-04-21T12:00:00.000Z",
      authorId: "user:author",
    });

    await expect(
      harness.service.deleteNote({
        noteId: "note-6",
        authorId: "user:admin",
        actorIsAdmin: true,
      }),
    ).resolves.toEqual({
      outcome: "applied",
    });
    expect(harness.notes.has("note-6")).toBe(false);
  });

  it("returns not_found when deleting a missing note", async () => {
    const harness = createHarness();

    await expect(
      harness.service.deleteNote({
        noteId: "note-missing",
        authorId: "user:author",
      }),
    ).resolves.toEqual({
      outcome: "not_found",
    });
  });
});
