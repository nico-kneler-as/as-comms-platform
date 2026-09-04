import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/src/server/auth/session", () => ({ requireSession }));

import { AUTOMATED_EMAIL_MERGE_FIELDS } from "@as-comms/domain";

import {
  publishTemplateAction,
  renderPreviewAction,
  saveDraftAction,
} from "../../app/settings/projects/[projectId]/automated-emails/actions";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

const projectId = "project:automated-email-preview";

function paragraph(content: readonly unknown[]): unknown {
  return { type: "paragraph", content };
}

describe("automated email preview", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    requireSession.mockReset();
    requireSession.mockResolvedValue({ id: "user:operator" });
    runtime = await createStage1WebTestRuntime();
    await runtime.context.settings.users.upsert({
      id: "user:operator",
      name: "Operator",
      email: "operator@example.org",
      emailVerified: new Date("2026-09-02T12:00:00.000Z"),
      image: null,
      role: "admin",
      deactivatedAt: null,
      createdAt: new Date("2026-09-02T12:00:00.000Z"),
      updatedAt: new Date("2026-09-02T12:00:00.000Z"),
    });
    await runtime.context.repositories.projectDimensions.upsert({
      projectId,
      projectName: "Whitebark Pine",
      source: "manual",
    });
    await runtime.context.settings.aliases.replaceForProject({
      projectId,
      aliases: ["whitebark@adventurescientists.org"],
      actorId: "user:operator",
    });
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  async function createTemplate(): Promise<string> {
    if (runtime === null) throw new Error("Expected test runtime");
    const template = await runtime.runtime.automatedEmails.createTemplate({
      projectId,
      name: "Training reminder #3",
      createdBy: null,
    });
    return template.id;
  }

  it("renders a draft that uses every catalog merge field", async () => {
    // The 2026-09-02 Salesforce import produced drafts using the Volunteer ID
    // and Esri username pills; the preview only supplied four values and threw.
    const templateId = await createTemplate();

    const result = await renderPreviewAction({
      projectId,
      templateId,
      draftSubject: "⏰ Training reminder for {{firstName}}",
      draftDoc: {
        type: "doc",
        content: [
          paragraph(
            AUTOMATED_EMAIL_MERGE_FIELDS.map((field) => ({
              type: "mergeField",
              attrs: { key: field.key },
            })),
          ),
        ],
      },
      samplePerson: "nico",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.subject).toBe("⏰ Training reminder for Nico");
    expect(result.data.html).toContain("4821");
    expect(result.data.html).toContain("nortiz_advsci");
    expect(result.data.html).toContain("Whitebark Pine");
  });

  it("names the offending link instead of the generic failure sentence", async () => {
    const templateId = await createTemplate();

    const result = await renderPreviewAction({
      projectId,
      templateId,
      draftSubject: "Training",
      draftDoc: {
        type: "doc",
        content: [
          paragraph([
            {
              type: "text",
              text: "Start Training",
              marks: [
                { type: "link", attrs: { href: "{!$Record.Event_URL__c}" } },
              ],
            },
          ]),
        ],
      },
      samplePerson: "nico",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("draft_render_invalid_link");
    expect(result.message).toContain('The link on "Start Training"');
    expect(result.message).toContain("{!$Record.Event_URL__c}");
  });

  it("refuses a document whose attrs failed to serialize", async () => {
    // ProseMirror attrs are null-prototype objects; handing them straight to a
    // server action serializes each as the string "$T", which silently strips
    // merge-field keys and link hrefs. The boundary must reject, not persist.
    const templateId = await createTemplate();
    const baseline = new Date().toISOString();

    const result = await saveDraftAction({
      projectId,
      templateId,
      draftSubject: "Training",
      draftDoc: {
        type: "doc",
        content: [
          paragraph([
            { type: "mergeField", attrs: "$T" },
            {
              type: "text",
              text: "Start",
              marks: [{ type: "link", attrs: "$T" }],
            },
          ]),
        ],
      },
      baselineUpdatedAt: baseline,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("validation_error");
  });

  it("accepts a document whose attrs are ordinary objects", async () => {
    if (runtime === null) throw new Error("Expected test runtime");
    const templateId = await createTemplate();
    const template =
      await runtime.runtime.automatedEmails.getTemplateById(templateId);
    if (template === null) throw new Error("Expected template");

    const result = await saveDraftAction({
      projectId,
      templateId,
      draftSubject: "Training",
      draftDoc: {
        type: "doc",
        content: [
          paragraph([
            { type: "mergeField", attrs: { key: "volunteerId" } },
            {
              type: "text",
              text: "Start",
              marks: [
                { type: "link", attrs: { href: "https://adventurescientists.org" } },
              ],
            },
          ]),
        ],
      },
      baselineUpdatedAt: template.updatedAt,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.data)).toContain("volunteerId");
  });

  it("refuses to publish a template with no subject", async () => {
    const templateId = await createTemplate();

    const result = await publishTemplateAction({ projectId, templateId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("publish_empty_subject");
  });

  it("refuses to publish a template with no body", async () => {
    if (runtime === null) throw new Error("Expected test runtime");
    const templateId = await createTemplate();
    const template =
      await runtime.runtime.automatedEmails.getTemplateById(templateId);
    if (template === null) throw new Error("Expected template");
    await saveDraftAction({
      projectId,
      templateId,
      draftSubject: "A subject with nothing under it",
      draftDoc: { type: "doc", content: [] },
      baselineUpdatedAt: template.updatedAt,
    });

    const result = await publishTemplateAction({ projectId, templateId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("publish_empty_body");
  });

  it("refuses to publish a draft the renderer would reject", async () => {
    if (runtime === null) throw new Error("Expected test runtime");
    const templateId = await createTemplate();
    const template =
      await runtime.runtime.automatedEmails.getTemplateById(templateId);
    if (template === null) throw new Error("Expected template");
    await saveDraftAction({
      projectId,
      templateId,
      draftSubject: "Training",
      draftDoc: {
        type: "doc",
        content: [
          paragraph([
            {
              type: "text",
              text: "Start Training",
              marks: [{ type: "link", attrs: { href: "tel:+14062891988" } }],
            },
          ]),
        ],
      },
      baselineUpdatedAt: template.updatedAt,
    });

    const result = await publishTemplateAction({ projectId, templateId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("draft_render_invalid_link");
  });

  it("publishes a draft that has a subject and real copy", async () => {
    if (runtime === null) throw new Error("Expected test runtime");
    const templateId = await createTemplate();
    const template =
      await runtime.runtime.automatedEmails.getTemplateById(templateId);
    if (template === null) throw new Error("Expected template");
    await saveDraftAction({
      projectId,
      templateId,
      draftSubject: "Training reminder for {{firstName}}",
      draftDoc: {
        type: "doc",
        content: [
          paragraph([
            { type: "text", text: "Hi " },
            { type: "mergeField", attrs: { key: "firstName" } },
          ]),
        ],
      },
      baselineUpdatedAt: template.updatedAt,
    });

    const result = await publishTemplateAction({ projectId, templateId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.publishedAt).not.toBeNull();
  });

  it("names the offending block for an unsupported node", async () => {
    const templateId = await createTemplate();

    const result = await renderPreviewAction({
      projectId,
      templateId,
      draftSubject: "Training",
      draftDoc: {
        type: "doc",
        content: [{ type: "heading", attrs: { level: 2 }, content: [] }],
      },
      samplePerson: "nico",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("draft_render_unsupported_node");
    expect(result.message).toContain("heading");
  });
});
