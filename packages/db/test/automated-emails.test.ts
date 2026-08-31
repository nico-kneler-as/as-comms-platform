import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  automatedEmailSends,
  automatedEmailTemplates,
} from "../src/index.js";
import {
  findRecentSendForDedupe,
  getLastReceivedAtByTemplateIds,
  listSendsByTemplate,
  createSendLogRow,
  updateSendStatus,
} from "../src/automated-email-sends-repository.js";
import {
  createTemplate,
  findLatestPublishedByKind,
  getTemplateById,
  listTemplatesByProject,
  publishTemplate,
  updateDraft,
} from "../src/automated-email-templates-repository.js";
import { createTestStage1Context, type TestStage1Context } from "./helpers.js";

function createUserRecord(id: string, email: string) {
  const now = new Date("2026-08-01T10:00:00.000Z");

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

describe("automated email repositories", () => {
  let context: TestStage1Context;

  beforeEach(async () => {
    context = await createTestStage1Context();
    await context.settings.users.upsert(
      createUserRecord("user:one", "one@example.org"),
    );
    await context.settings.users.upsert(
      createUserRecord("user:two", "two@example.org"),
    );
    await context.repositories.projectDimensions.upsert({
      projectId: "project:one",
      projectName: "Project One",
      source: "salesforce",
    });
    await context.repositories.projectDimensions.upsert({
      projectId: "project:two",
      projectName: "Project Two",
      source: "salesforce",
    });
    await context.repositories.contacts.upsert({
      id: "contact:one",
      salesforceContactId: "003000000000001",
      displayName: "Volunteer One",
      primaryEmail: "volunteer@example.org",
      primaryPhone: null,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
    });
  });

  afterEach(async () => {
    await context.dispose();
  });

  it("creates, gets, and lists inactive custom templates with empty drafts", async () => {
    const older = await createTemplate(context.db, {
      projectId: "project:one",
      name: "Older",
      createdBy: "user:one",
    });
    const newer = await createTemplate(context.db, {
      projectId: "project:one",
      name: "Newer",
      draftSubject: "Welcome",
      draftDoc: { type: "doc", content: [] },
      createdBy: "user:one",
    });
    await context.db
      .update(automatedEmailTemplates)
      .set({ createdAt: new Date("2026-08-01T11:00:00.000Z") })
      .where(eq(automatedEmailTemplates.id, older.id));
    await context.db
      .update(automatedEmailTemplates)
      .set({ createdAt: new Date("2026-08-01T12:00:00.000Z") })
      .where(eq(automatedEmailTemplates.id, newer.id));

    expect(older).toMatchObject({
      kind: "custom",
      isActive: false,
      draftSubject: "",
      draftDoc: {},
      publishedSubject: null,
      publishedDoc: null,
    });
    await expect(getTemplateById(context.db, newer.id)).resolves.toMatchObject({
      id: newer.id,
      name: "Newer",
    });
    await expect(listTemplatesByProject(context.db, "project:one")).resolves
      .toMatchObject([{ id: newer.id }, { id: older.id }]);
  });

  it("guards draft updates and reports a stale baseline without clobbering the draft", async () => {
    const created = await createTemplate(context.db, {
      projectId: "project:one",
      name: "Application received",
      createdBy: "user:one",
    });
    const baseline = new Date("2026-08-01T13:00:00.000Z");
    await context.db
      .update(automatedEmailTemplates)
      .set({ updatedAt: baseline })
      .where(eq(automatedEmailTemplates.id, created.id));

    const updated = await updateDraft(context.db, created.id, {
      draftSubject: "Thank you",
      draftDoc: { body: "first draft" },
      baselineUpdatedAt: baseline.toISOString(),
    });
    expect("conflict" in updated).toBe(false);

    const stale = await updateDraft(context.db, created.id, {
      draftSubject: "Stale overwrite",
      draftDoc: { body: "stale" },
      baselineUpdatedAt: baseline.toISOString(),
    });
    expect(stale).toEqual({ conflict: true });
    await expect(getTemplateById(context.db, created.id)).resolves.toMatchObject({
      draftSubject: "Thank you",
      draftDoc: { body: "first draft" },
    });
  });

  it("publishes snapshots atomically and finds the newest eligible kind", async () => {
    const first = await createTemplate(context.db, {
      projectId: "project:one",
      kind: "accepted",
      name: "First",
      draftSubject: "First published",
      draftDoc: { revision: 1 },
      createdBy: "user:one",
    });
    const unpublished = await createTemplate(context.db, {
      projectId: "project:one",
      kind: "accepted",
      name: "Unpublished",
      createdBy: "user:one",
    });
    const second = await createTemplate(context.db, {
      projectId: "project:two",
      kind: "accepted",
      name: "Second",
      draftSubject: "Second published",
      draftDoc: { revision: 1 },
      createdBy: "user:two",
    });

    const firstPublished = await publishTemplate(context.db, first.id, "user:one");
    expect(firstPublished).toMatchObject({
      publishedSubject: "First published",
      publishedDoc: { revision: 1 },
      publishedBy: "user:one",
    });
    expect(firstPublished.publishedAt).not.toBeNull();

    const reDrafted = await updateDraft(context.db, first.id, {
      draftSubject: "First republished",
      draftDoc: { revision: 2 },
      baselineUpdatedAt: firstPublished.updatedAt,
    });
    expect("conflict" in reDrafted).toBe(false);
    const republished = await publishTemplate(context.db, first.id, "user:two");
    expect(republished).toMatchObject({
      publishedSubject: "First republished",
      publishedDoc: { revision: 2 },
      publishedBy: "user:two",
    });

    await publishTemplate(context.db, second.id, "user:two");
    await context.db
      .update(automatedEmailTemplates)
      .set({ publishedAt: new Date("2026-08-01T15:00:00.000Z") })
      .where(eq(automatedEmailTemplates.id, first.id));
    await context.db
      .update(automatedEmailTemplates)
      .set({ publishedAt: new Date("2026-08-01T16:00:00.000Z") })
      .where(eq(automatedEmailTemplates.id, second.id));

    await expect(findLatestPublishedByKind(context.db, "accepted")).resolves
      .toMatchObject({ id: second.id });
    await expect(
      findLatestPublishedByKind(context.db, "accepted", {
        excludeProjectId: "project:two",
      }),
    ).resolves.toMatchObject({ id: first.id });
    await expect(getTemplateById(context.db, unpublished.id)).resolves.toMatchObject({
      publishedAt: null,
    });
  });

  it("records send outcomes, dedupes only sent rows, and paginates send history", async () => {
    const template = await createTemplate(context.db, {
      projectId: "project:one",
      name: "Application received",
      createdBy: "user:one",
    });
    const held = await createSendLogRow(context.db, {
      templateId: template.id,
      projectId: "project:one",
      expeditionMemberId: "a0B000000000001",
      contactId: "contact:one",
      payload: { flow: "held" },
    });
    const heldResult = await updateSendStatus(context.db, held.id, {
      status: "held",
      statusReason: "Template inactive",
      renderedPreview: { subject: "Held", html: "<p>Held</p>", text: "Held" },
    });
    expect(heldResult).toMatchObject({
      status: "held",
      statusReason: "Template inactive",
    });
    expect(typeof heldResult.processedAt).toBe("string");

    const failed = await createSendLogRow(context.db, {
      templateId: template.id,
      projectId: "project:one",
      expeditionMemberId: "a0B000000000001",
      contactId: "contact:one",
      payload: { flow: "failed" },
    });
    await updateSendStatus(context.db, failed.id, {
      status: "failed",
      statusReason: "Provider unavailable",
    });
    const sent = await createSendLogRow(context.db, {
      templateId: template.id,
      projectId: "project:one",
      expeditionMemberId: "a0B000000000001",
      contactId: "contact:one",
      payload: { flow: "sent" },
    });
    await updateSendStatus(context.db, sent.id, {
      status: "sent",
      ledgerEventId: "event:one",
      providerMessageId: "provider:one",
    });
    const duplicate = await createSendLogRow(context.db, {
      templateId: template.id,
      projectId: "project:one",
      expeditionMemberId: "a0B000000000001",
      contactId: "contact:one",
      payload: { flow: "duplicate" },
    });
    await updateSendStatus(context.db, duplicate.id, { status: "duplicate" });
    await context.db
      .update(automatedEmailSends)
      .set({ receivedAt: new Date("2026-08-01T11:00:00.000Z") })
      .where(eq(automatedEmailSends.id, held.id));
    await context.db
      .update(automatedEmailSends)
      .set({ receivedAt: new Date("2026-08-01T12:00:00.000Z") })
      .where(eq(automatedEmailSends.id, failed.id));
    await context.db
      .update(automatedEmailSends)
      .set({ receivedAt: new Date("2026-08-01T13:00:00.000Z") })
      .where(eq(automatedEmailSends.id, sent.id));
    await context.db
      .update(automatedEmailSends)
      .set({ receivedAt: new Date("2026-08-01T14:00:00.000Z") })
      .where(eq(automatedEmailSends.id, duplicate.id));

    await expect(
      findRecentSendForDedupe(context.db, {
        templateId: template.id,
        expeditionMemberId: "a0B000000000001",
        since: new Date("2026-08-01T12:30:00.000Z"),
      }),
    ).resolves.toMatchObject({ id: sent.id });
    await expect(
      findRecentSendForDedupe(context.db, {
        templateId: template.id,
        expeditionMemberId: "a0B000000000001",
        since: new Date("2026-08-01T13:30:00.000Z"),
      }),
    ).resolves.toBeNull();

    const firstPage = await listSendsByTemplate(context.db, {
      templateId: template.id,
      limit: 2,
    });
    expect(firstPage.items.map((row) => row.id)).toEqual([duplicate.id, sent.id]);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await listSendsByTemplate(context.db, {
      templateId: template.id,
      limit: 2,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.items.map((row) => row.id)).toEqual([failed.id, held.id]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("returns latest receipt time for sent and unsent template ids", async () => {
    const withSends = await createTemplate(context.db, {
      projectId: "project:one",
      name: "With sends",
      createdBy: "user:one",
    });
    const withoutSends = await createTemplate(context.db, {
      projectId: "project:one",
      name: "Without sends",
      createdBy: "user:one",
    });
    const first = await createSendLogRow(context.db, {
      templateId: withSends.id,
      projectId: "project:one",
      expeditionMemberId: "a0B000000000002",
      contactId: null,
      payload: { index: 1 },
    });
    const second = await createSendLogRow(context.db, {
      templateId: withSends.id,
      projectId: "project:one",
      expeditionMemberId: "a0B000000000003",
      contactId: null,
      payload: { index: 2 },
    });
    await context.db
      .update(automatedEmailSends)
      .set({ receivedAt: new Date("2026-08-01T17:00:00.000Z") })
      .where(eq(automatedEmailSends.id, first.id));
    await context.db
      .update(automatedEmailSends)
      .set({ receivedAt: new Date("2026-08-01T18:00:00.000Z") })
      .where(eq(automatedEmailSends.id, second.id));

    const receivedAtByTemplateId = await getLastReceivedAtByTemplateIds(
      context.db,
      [withSends.id, withoutSends.id],
    );
    expect(receivedAtByTemplateId.get(withSends.id)).toBe(
      "2026-08-01T18:00:00.000Z",
    );
    expect(receivedAtByTemplateId.get(withoutSends.id)).toBeNull();
  });
});
