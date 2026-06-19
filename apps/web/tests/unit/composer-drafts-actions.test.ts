import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.hoisted(() => vi.fn());
const getStage1WebRuntime = vi.hoisted(() => vi.fn());
const upsertComposerDraft = vi.hoisted(() => vi.fn());
const listComposerDraftsByActor = vi.hoisted(() => vi.fn());
const deleteComposerDraft = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/session", () => ({
  requireSession,
}));

vi.mock("@/src/server/stage1-runtime", () => ({
  getStage1WebRuntime,
}));

vi.mock("@as-comms/db", () => ({
  upsertComposerDraft,
  listComposerDraftsByActor,
  deleteComposerDraft,
}));

import {
  deleteComposerDraftAction,
  listComposerDraftsAction,
  upsertComposerDraftAction,
} from "../../src/server/composer/drafts";

describe("composer draft actions", () => {
  beforeEach(() => {
    requireSession.mockReset();
    getStage1WebRuntime.mockReset();
    upsertComposerDraft.mockReset();
    listComposerDraftsByActor.mockReset();
    deleteComposerDraft.mockReset();

    getStage1WebRuntime.mockResolvedValue({
      connection: { db: { mocked: true } },
    });
  });

  it("rejects when no session is available", async () => {
    requireSession.mockRejectedValue(new Error("UNAUTHORIZED"));

    const result = await listComposerDraftsAction({ limit: 50 });

    expect(result).toMatchObject({
      ok: false,
      code: "unauthorized",
    });
  });

  it("uses actor_id from the session rather than the client payload", async () => {
    requireSession.mockResolvedValue({ id: "user:session" });
    upsertComposerDraft.mockResolvedValue({
      id: "draft-1",
      actorId: "user:session",
      paneMode: "new-draft",
      channel: "email",
      recipientAnchorKind: "email",
      recipientContactId: null,
      recipientEmail: "person@example.org",
      recipientPhone: null,
      subject: "Hello",
      bodyPlaintext: "Body",
      bodyHtml: "<p>Body</p>",
      selectedAlias: "forest@adventuresci.org",
      cc: [],
      bcc: [],
      attachments: [],
      aiDirective: "",
      replyContextThreadCursor: null,
      forwardContext: null,
      createdAt: "2026-06-19T10:00:00.000Z",
      updatedAt: "2026-06-19T10:00:00.000Z",
    });

    const result = await upsertComposerDraftAction({
      actor_id: "spoofed-user",
      pane_mode: "new_draft",
      channel: "email",
      recipient_anchor_kind: "email",
      recipient_contact_id: null,
      recipient_email: "person@example.org",
      recipient_phone: null,
      subject: "Hello",
      body_plaintext: "Body",
      body_html: "<p>Body</p>",
      selected_alias: "forest@adventuresci.org",
      cc: [],
      bcc: [],
      attachments: [],
      ai_directive: "",
      reply_context_thread_cursor: null,
      forward_context: null,
    } as never);

    expect(result.ok).toBe(true);
    expect(upsertComposerDraft).toHaveBeenCalledWith(
      { mocked: true },
      expect.objectContaining({
        actorId: "user:session",
      }),
    );
  });

  it("maps validation failures to the standard envelope", async () => {
    const result = await deleteComposerDraftAction({ id: "not-a-uuid" });

    expect(result).toMatchObject({
      ok: false,
      code: "validation_error",
      fieldErrors: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- `expect.any` returns `any` by design for asymmetric matchers.
        id: expect.any(String),
      },
    });
  });
});
