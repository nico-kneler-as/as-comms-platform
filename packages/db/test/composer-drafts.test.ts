import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { composerDrafts } from "../src/index.js";
import {
  deleteComposerDraft,
  listComposerDraftsByActor,
  upsertComposerDraft,
} from "../src/composer-drafts-repository.js";
import { createTestStage1Context, type TestStage1Context } from "./helpers.js";

function createUserRecord(id: string, email: string) {
  const now = new Date("2026-06-19T10:00:00.000Z");

  return {
    id,
    name: id,
    email,
    emailVerified: now,
    image: null,
    role: "operator" as const,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function seedContact(context: TestStage1Context, contactId: string) {
  await context.repositories.contacts.upsert({
    id: contactId,
    salesforceContactId: null,
    displayName: contactId,
    primaryEmail: `${contactId}@example.org`,
    primaryPhone: "+14065550123",
    createdAt: "2026-06-19T10:00:00.000Z",
    updatedAt: "2026-06-19T10:00:00.000Z",
  });
}

function buildDraftInput(overrides: Partial<Parameters<typeof upsertComposerDraft>[1]> = {}) {
  return {
    actorId: "user:one",
    paneMode: "new-draft" as const,
    channel: "email" as const,
    recipientAnchorKind: "contact" as const,
    recipientContactId: "contact:one",
    recipientEmail: "contact.one@example.org",
    recipientPhone: null,
    subject: "Draft subject",
    bodyPlaintext: "Draft body",
    bodyHtml: "<p>Draft body</p>",
    selectedAlias: "forest@adventuresci.org",
    cc: ["cc@example.org"],
    bcc: [],
    attachments: [
      {
        filename: "brief.pdf",
        size: 1024,
        contentType: "application/pdf",
      },
    ],
    aiDirective: "keep it concise",
    replyContextThreadCursor: null,
    forwardContext: null,
    ...overrides,
  };
}

describe("composer draft repository", () => {
  let context: TestStage1Context;

  beforeEach(async () => {
    context = await createTestStage1Context();
    await context.settings.users.upsert(
      createUserRecord("user:one", "one@example.org"),
    );
    await context.settings.users.upsert(
      createUserRecord("user:two", "two@example.org"),
    );
    await seedContact(context, "contact:one");
    await seedContact(context, "contact:two");
  });

  afterEach(async () => {
    await context.dispose();
  });

  it("inserts a draft when id is absent", async () => {
    const inserted = await upsertComposerDraft(
      context.db,
      buildDraftInput(),
    );

    expect(inserted).not.toBeNull();
    expect(inserted?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(inserted).toMatchObject({
      actorId: "user:one",
      channel: "email",
      paneMode: "new-draft",
      subject: "Draft subject",
    });
  });

  it("updates a draft when id is present and actorId matches", async () => {
    const inserted = await upsertComposerDraft(context.db, buildDraftInput());
    if (inserted === null) {
      throw new Error("expected inserted draft");
    }

    const updated = await upsertComposerDraft(
      context.db,
      buildDraftInput({
        id: inserted.id,
        subject: "Updated subject",
        bodyPlaintext: "Updated body",
        bodyHtml: "<p>Updated body</p>",
      }),
    );

    expect(updated).toMatchObject({
      id: inserted.id,
      subject: "Updated subject",
      bodyPlaintext: "Updated body",
    });
  });

  it("does not update a draft owned by a different actor", async () => {
    const inserted = await upsertComposerDraft(context.db, buildDraftInput());
    if (inserted === null) {
      throw new Error("expected inserted draft");
    }

    const updated = await upsertComposerDraft(
      context.db,
      buildDraftInput({
        id: inserted.id,
        actorId: "user:two",
        subject: "spoofed",
      }),
    );

    const listed = await listComposerDraftsByActor(context.db, {
      actorId: "user:one",
      limit: 10,
      cursor: null,
    });

    expect(updated).toBeNull();
    expect(listed.drafts[0]?.subject).toBe("Draft subject");
  });

  it("lists drafts by actor ordered by updatedAt desc and respects limit", async () => {
    const first = await upsertComposerDraft(
      context.db,
      buildDraftInput({ subject: "First", recipientContactId: "contact:one" }),
    );
    const second = await upsertComposerDraft(
      context.db,
      buildDraftInput({
        subject: "Second",
        recipientContactId: "contact:two",
        recipientEmail: "contact.two@example.org",
      }),
    );

    if (first === null || second === null) {
      throw new Error("expected drafts");
    }

    await context.db
      .update(composerDrafts)
      .set({ updatedAt: new Date("2026-06-19T10:00:00.000Z") })
      .where(eq(composerDrafts.id, first.id));
    await context.db
      .update(composerDrafts)
      .set({ updatedAt: new Date("2026-06-19T11:00:00.000Z") })
      .where(eq(composerDrafts.id, second.id));

    const listed = await listComposerDraftsByActor(context.db, {
      actorId: "user:one",
      limit: 1,
      cursor: null,
    });

    expect(listed.drafts.map((draft) => draft.subject)).toEqual(["Second"]);
    expect(listed.nextCursor).not.toBeNull();
  });

  it("lists drafts only for the requested actor", async () => {
    await upsertComposerDraft(context.db, buildDraftInput());
    await upsertComposerDraft(
      context.db,
      buildDraftInput({
        actorId: "user:two",
        recipientContactId: "contact:two",
        recipientEmail: "contact.two@example.org",
        subject: "Other actor draft",
      }),
    );

    const listed = await listComposerDraftsByActor(context.db, {
      actorId: "user:one",
      limit: 10,
      cursor: null,
    });

    expect(listed.drafts).toHaveLength(1);
    expect(listed.drafts[0]?.actorId).toBe("user:one");
  });

  it("deletes only the matching id and actorId pair and returns zero when missing", async () => {
    const inserted = await upsertComposerDraft(context.db, buildDraftInput());
    if (inserted === null) {
      throw new Error("expected inserted draft");
    }

    const wrongActorDelete = await deleteComposerDraft(context.db, {
      id: inserted.id,
      actorId: "user:two",
    });
    const deleted = await deleteComposerDraft(context.db, {
      id: inserted.id,
      actorId: "user:one",
    });
    const deletedAgain = await deleteComposerDraft(context.db, {
      id: inserted.id,
      actorId: "user:one",
    });

    expect(wrongActorDelete).toBe(0);
    expect(deleted).toBe(1);
    expect(deletedAgain).toBe(0);
  });

  it("round-trips sms replying drafts with forward context intact", async () => {
    const inserted = await upsertComposerDraft(
      context.db,
      buildDraftInput({
        paneMode: "replying",
        channel: "sms",
        recipientAnchorKind: "contact",
        recipientPhone: "+14065550123",
        subject: "",
        bodyPlaintext: "SMS draft body",
        bodyHtml: "",
        selectedAlias: null,
        cc: [],
        bcc: [],
        attachments: [],
        replyContextThreadCursor: "thread-cursor-1",
        forwardContext: {
          originalEntryId: "entry-1",
          originalSubject: "Field update",
          originalFromLabel: "Jim",
          originalToLabel: "Forest team",
          originalCcLabel: "cc@example.org",
          originalOccurredAtIso: "2026-06-19T09:00:00.000Z",
          originalBodyPlaintext: "Forwarded body",
          originalBodyHtml: "<p>Forwarded body</p>",
          defaultAlias: "forest@adventuresci.org",
        },
      }),
    );

    expect(inserted).toMatchObject({
      channel: "sms",
      paneMode: "replying",
      bodyPlaintext: "SMS draft body",
      replyContextThreadCursor: "thread-cursor-1",
      forwardContext: {
        originalEntryId: "entry-1",
        originalBodyHtml: "<p>Forwarded body</p>",
      },
    });
  });
});
