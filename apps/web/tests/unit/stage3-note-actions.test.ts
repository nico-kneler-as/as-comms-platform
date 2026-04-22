import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStage1InternalNoteService } from "@as-comms/domain";

const revalidateTag = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const requireSession = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
  revalidateTag,
  revalidatePath,
}));

vi.mock("@/src/server/auth/session", () => ({
  requireSession,
}));

import {
  createNoteAction,
  deleteNoteAction,
  updateNoteAction,
} from "../../app/inbox/actions";
import { resetSecurityRateLimiterForTests } from "../../src/server/security/rate-limit";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function buildCurrentUser(input?: {
  readonly id?: string;
  readonly name?: string | null;
  readonly email?: string;
}) {
  const now = new Date("2026-04-21T12:00:00.000Z");

  return {
    id: input?.id ?? "user:operator",
    name: input?.name ?? "Operator Name",
    email: input?.email ?? "operator@example.org",
    emailVerified: now,
    image: null,
    role: "operator" as const,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function seedOperator(
  runtime: Stage1WebTestRuntime,
  user = buildCurrentUser(),
): Promise<void> {
  await runtime.context.settings.users.upsert(user);
}

async function seedContact(runtime: Stage1WebTestRuntime): Promise<void> {
  await runtime.context.repositories.contacts.upsert({
    id: "contact:existing",
    salesforceContactId: null,
    displayName: "Existing Contact",
    primaryEmail: "existing@example.org",
    primaryPhone: null,
    createdAt: "2026-04-21T12:00:00.000Z",
    updatedAt: "2026-04-21T12:00:00.000Z",
  });
}

describe("note server actions", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    revalidateTag.mockReset();
    revalidatePath.mockReset();
    requireSession.mockReset();
    resetSecurityRateLimiterForTests();
    requireSession.mockResolvedValue(buildCurrentUser());
    runtime = await createStage1WebTestRuntime();
    await seedOperator(runtime);
    await seedContact(runtime);
  });

  afterEach(async () => {
    resetSecurityRateLimiterForTests();
    await runtime?.dispose();
    runtime = null;
  });

  it("creates an authored note, records audit, and revalidates the inbox contact", async () => {
    const result = await createNoteAction({
      contactId: "contact:existing",
      body: "Call back on Thursday",
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        contactId: "contact:existing",
      },
    });

    if (!runtime || !result.ok) {
      throw new Error("Expected runtime and successful result.");
    }

    const sourceEvidenceId = `source-evidence:manual:note:${result.data.noteId}`;
    const notes =
      await runtime.context.repositories.manualNoteDetails.listBySourceEvidenceIds(
        [sourceEvidenceId],
      );
    const audits =
      await runtime.context.repositories.auditEvidence.listByEntity({
        entityType: "internal_note",
        entityId: result.data.noteId,
      });

    expect(notes).toEqual([
      expect.objectContaining({
        sourceEvidenceId,
        body: "Call back on Thursday",
        authorDisplayName: "Operator Name",
        authorId: "user:operator",
      }),
    ]);
    expect(audits.map((audit) => audit.action)).toEqual(["inbox.note_created"]);
    expect(revalidateTag).toHaveBeenCalledTimes(3);
    expect(revalidateTag).toHaveBeenNthCalledWith(1, "inbox");
    expect(revalidateTag).toHaveBeenNthCalledWith(
      2,
      "inbox:contact:contact:existing",
    );
    expect(revalidateTag).toHaveBeenNthCalledWith(
      3,
      "timeline:contact:contact:existing",
    );
  });

  it("rejects invalid note bodies", async () => {
    await expect(
      createNoteAction({
        contactId: "contact:existing",
        body: "   ",
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "validation_error",
    });

    await expect(
      createNoteAction({
        contactId: "contact:existing",
        body: "a".repeat(10_001),
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "validation_error",
    });

    await expect(
      createNoteAction({
        contactId: "contact:existing",
        body: "<b>not plaintext</b>",
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "validation_error",
    });
  });

  it("returns forbidden when another operator tries to update a note", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await runtime.context.settings.users.upsert(
      buildCurrentUser({
        id: "user:author",
        name: "Author User",
        email: "author@example.org",
      }),
    );

    const internalNotes = createStage1InternalNoteService({
      persistence: runtime.context.persistence,
      normalization: runtime.context.normalization,
    });

    await internalNotes.createNote({
      noteId: "note-update-forbidden",
      contactId: "contact:existing",
      body: "Original body",
      occurredAt: "2026-04-21T12:00:00.000Z",
      authorDisplayName: "Author User",
      authorId: "user:author",
    });

    await expect(
      updateNoteAction({
        noteId: "note-update-forbidden",
        body: "Changed body",
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });

  it("returns forbidden when another operator tries to delete a note", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await runtime.context.settings.users.upsert(
      buildCurrentUser({
        id: "user:author",
        name: "Author User",
        email: "author@example.org",
      }),
    );

    const internalNotes = createStage1InternalNoteService({
      persistence: runtime.context.persistence,
      normalization: runtime.context.normalization,
    });

    await internalNotes.createNote({
      noteId: "note-delete-forbidden",
      contactId: "contact:existing",
      body: "Original body",
      occurredAt: "2026-04-21T12:00:00.000Z",
      authorDisplayName: "Author User",
      authorId: "user:author",
    });

    await expect(
      deleteNoteAction({
        noteId: "note-delete-forbidden",
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });

  it("rate limits note creation after 60 requests per minute", async () => {
    for (let index = 0; index < 60; index += 1) {
      const result = await createNoteAction({
        contactId: "contact:existing",
        body: `Note ${String(index)}`,
      });

      expect(result.ok).toBe(true);
    }

    await expect(
      createNoteAction({
        contactId: "contact:existing",
        body: "Rate limited note",
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "rate_limit_exceeded",
    });
  });
});
