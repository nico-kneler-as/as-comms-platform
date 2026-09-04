"use server";

import { randomUUID } from "node:crypto";

import {
  automatedEmailKindSchema,
  type AutomatedEmailKind,
} from "@as-comms/contracts";
import {
  AutomatedEmailRenderError,
  automatedEmailMergeFieldLabel,
  buildAutomatedEmailSampleValues,
  renderAutomatedEmail,
} from "@as-comms/domain";
import { z } from "zod";

import type { UiError, UiSuccess } from "@/src/server/ui-result";
import { requireSession } from "@/src/server/auth/session";
import { getAutomatedEmailTestSendRuntime } from "@/src/server/automated-email/postmark-test-send";
import { revalidateAutomatedEmailViews } from "@/src/server/settings/revalidate";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";
import { enqueueAutomatedEmailSendJob } from "@/src/server/automated-email/enqueue";
import {
  loadAutomatedEmailKindSources,
  loadAutomatedEmailSendLogPage,
} from "@/src/server/automated-email/selectors";

const lifecycleKinds = [
  "application_received",
  "application_nudge",
  "application_submitted",
  "accepted",
  "denied",
  "training_reminder",
  "training_passed",
  "trip_planning",
  "data_reminder",
  "first_record",
  "post_trip",
] as const satisfies readonly AutomatedEmailKind[];

const kindNames: Readonly<Record<(typeof lifecycleKinds)[number], string>> = {
  application_received: "Application received",
  application_nudge: "Application nudge",
  application_submitted: "Application submitted",
  accepted: "Accepted",
  denied: "Denied",
  training_reminder: "Training reminder",
  training_passed: "Training passed",
  trip_planning: "Trip planning / gear",
  data_reminder: "Data reminder",
  first_record: "First record",
  post_trip: "Post-trip",
};

const templateTargetSchema = z.object({
  projectId: z.string().trim().min(1),
  templateId: z.string().uuid(),
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every `attrs` in the document must be an object.
 *
 * A client that hands React a ProseMirror node verbatim serializes its
 * null-prototype `attrs` as the string `"$T"` (a temporary reference), which
 * silently strips merge-field keys and link hrefs. `z.unknown()` waved that
 * through and the corruption reached the database, so the boundary now rejects
 * any document whose attributes are not objects rather than storing it.
 */
function hasWellFormedAttributes(node: unknown): boolean {
  if (Array.isArray(node)) {
    return node.every(hasWellFormedAttributes);
  }

  if (!isPlainObject(node)) {
    return true;
  }

  if (node.attrs !== undefined && node.attrs !== null && !isPlainObject(node.attrs)) {
    return false;
  }

  return (
    hasWellFormedAttributes(node.content) && hasWellFormedAttributes(node.marks)
  );
}

const automatedEmailDocumentSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.unknown()).optional(),
  })
  .passthrough()
  .refine(hasWellFormedAttributes, {
    message:
      "Document contains a node whose attributes could not be serialized.",
  });

const projectTargetSchema = z.object({
  projectId: z.string().trim().min(1),
});

const createFromKindsSchema = z.object({
  projectId: z.string().trim().min(1),
  kinds: z
    .array(automatedEmailKindSchema)
    .max(lifecycleKinds.length)
    .refine((kinds) => kinds.every((kind) => kind !== "custom")),
  includeCustom: z.boolean(),
});

const renameSchema = templateTargetSchema.extend({
  name: z.string().trim().min(1).max(160),
});

const saveDraftSchema = templateTargetSchema.extend({
  draftSubject: z.string().max(500),
  draftDoc: automatedEmailDocumentSchema,
  baselineUpdatedAt: z.string().datetime(),
});

const setActiveSchema = templateTargetSchema.extend({
  isActive: z.boolean(),
});

const previewSchema = templateTargetSchema.extend({
  draftSubject: z.string().max(500),
  draftDoc: automatedEmailDocumentSchema,
  samplePerson: z.enum(["nico", "selah"]),
});

const sendTestSchema = previewSchema.extend({
  recipientEmail: z.string().trim().email(),
});

const sendLogPageSchema = templateTargetSchema.extend({
  cursor: z.string().min(1).nullable().optional(),
});

const sendNowSchema = templateTargetSchema.extend({
  sendId: z.string().uuid(),
});

type TemplateMutationData = Readonly<{
  id: string;
  name: string;
  draftSubject: string;
  draftDoc: unknown;
  publishedSubject: string | null;
  publishedDoc: unknown;
  publishedAt: string | null;
  isActive: boolean;
  updatedAt: string;
}>;

type PreviewData = Readonly<{
  fromEmail: string;
  toEmail: string;
  subject: string;
  html: string;
  text: string;
  sampleFirstName: string;
}>;

// Personas only need to carry the fields that should differ between the two
// preview identities. Everything else — including merge fields added later —
// comes from the domain catalog via buildAutomatedEmailSampleValues, so no
// template can fail to preview for want of a sample value.
const samplePeople = {
  nico: {
    firstName: "Nico",
    lastName: "Ortiz",
    email: "nico.ortiz@gmail.com",
    volunteerId: "4821",
    esriUsername: "nortiz_advsci",
  },
  selah: {
    firstName: "Selah",
    lastName: "Whitcomb",
    email: "selah.w@fastmail.com",
    volunteerId: "5137",
    esriUsername: "swhitcomb_advsci",
  },
} as const;

/**
 * Turns a renderer failure into something an operator can act on without
 * opening a ticket: which merge field, which link, which block. The generic
 * sentence is the last resort, not the default (PRD #693 follow-up).
 */
function describeRenderFailure(error: unknown): UiError {
  if (!(error instanceof AutomatedEmailRenderError)) {
    return errorResult(
      "draft_render_failed",
      "This draft cannot be rendered. Check its merge fields and formatting, then try again.",
    );
  }

  switch (error.code) {
    case "malformed_token":
      return errorResult(
        "draft_render_malformed_token",
        "The subject line has an unclosed {{ merge token. Fix the subject and try again.",
      );
    case "unknown_token":
      return errorResult(
        "draft_render_unknown_token",
        `The subject line uses {{${error.offender}}}, which is not a merge field. Insert merge fields with the picker instead of typing them.`,
      );
    case "missing_value":
      return errorResult(
        "draft_render_missing_value",
        `The preview has no sample value for the ${automatedEmailMergeFieldLabel(error.offender)} merge field. Report this — the preview's sample data needs updating.`,
      );
    case "invalid_link": {
      const linkText =
        error.context !== null && error.context.trim().length > 0
          ? `The link on "${error.context.trim()}"`
          : "A link in this draft";
      return errorResult(
        "draft_render_invalid_link",
        `${linkText} points to ${error.offender}, which is not a supported address. Links must start with http://, https:// or mailto:.`,
      );
    }
    case "unsupported_mark":
      return errorResult(
        "draft_render_unsupported_mark",
        `This draft uses ${error.offender} formatting, which automated emails cannot send. Remove it and try again.`,
      );
    case "unsupported_node":
      return errorResult(
        "draft_render_unsupported_node",
        `This draft contains a ${error.offender} block, which automated emails cannot send. Remove it and try again.`,
      );
    default:
      return errorResult(
        "draft_render_failed",
        "This draft cannot be rendered. Check its merge fields and formatting, then try again.",
      );
  }
}

function requestId(): string {
  return randomUUID();
}

function errorResult(
  code: string,
  message: string,
  retryable = false,
): UiError {
  return {
    ok: false,
    code,
    message,
    requestId: requestId(),
    ...(retryable ? { retryable: true } : {}),
  };
}

function success<T>(data: T): UiSuccess<T> {
  return { ok: true, data, requestId: requestId() };
}

function serializeTemplate(input: {
  readonly id: string;
  readonly name: string;
  readonly draftSubject: string;
  readonly draftDoc?: unknown;
  readonly publishedSubject?: string | null;
  readonly publishedDoc?: unknown;
  readonly publishedAt?: string | null;
  readonly isActive: boolean;
  readonly updatedAt: string;
}): TemplateMutationData {
  return {
    id: input.id,
    name: input.name,
    draftSubject: input.draftSubject,
    draftDoc: input.draftDoc ?? { type: "doc", content: [] },
    publishedSubject: input.publishedSubject ?? null,
    publishedDoc: input.publishedDoc ?? null,
    publishedAt: input.publishedAt ?? null,
    isActive: input.isActive,
    updatedAt: input.updatedAt,
  };
}

async function loadOwnedTemplate(projectId: string, templateId: string) {
  const runtime = await getStage1WebRuntime();
  const template = await runtime.automatedEmails.getTemplateById(templateId);
  return template?.projectId !== projectId ? null : { runtime, template };
}

async function renderDraft(input: {
  readonly projectId: string;
  readonly templateId: string;
  readonly draftSubject: string;
  readonly draftDoc: unknown;
  readonly samplePerson: keyof typeof samplePeople;
}): Promise<
  | { readonly ok: true; readonly data: PreviewData }
  | { readonly ok: false; readonly error: UiError }
> {
  const owned = await loadOwnedTemplate(input.projectId, input.templateId);
  if (owned === null) {
    return {
      ok: false,
      error: errorResult(
        "template_not_found",
        "That automated email was not found.",
      ),
    };
  }

  const project = await owned.runtime.settings.projects.findById(
    input.projectId,
  );
  if (project === null) {
    return {
      ok: false,
      error: errorResult("project_not_found", "That project was not found."),
    };
  }
  const fromEmail =
    project.emails.find((email) => email.isPrimary)?.address ??
    project.emails[0]?.address ??
    null;
  if (fromEmail === null) {
    return {
      ok: false,
      error: errorResult(
        "missing_project_sender",
        "Add a project inbox alias before previewing or sending a test.",
      ),
    };
  }

  const person = samplePeople[input.samplePerson];
  try {
    const rendered = renderAutomatedEmail({
      subjectTemplate: input.draftSubject,
      bodyDoc: input.draftDoc,
      values: buildAutomatedEmailSampleValues({
        ...person,
        projectName: project.projectName,
      }),
      frame: {
        projectName: project.projectName,
        reasonLine: `You're receiving this because you applied to ${project.projectName}.`,
      },
    });

    return {
      ok: true,
      data: {
        fromEmail,
        toEmail: person.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        sampleFirstName: person.firstName,
      },
    };
  } catch (error) {
    return { ok: false, error: describeRenderFailure(error) };
  }
}

export async function createFromKindsAction(input: {
  readonly projectId: string;
  readonly kinds: readonly AutomatedEmailKind[];
  readonly includeCustom: boolean;
}): Promise<UiSuccess<readonly TemplateMutationData[]> | UiError> {
  const session = await requireSession();
  const parsed = createFromKindsSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      "validation_error",
      "Choose one or more email kinds to create.",
    );
  }
  if (parsed.data.kinds.length === 0 && !parsed.data.includeCustom) {
    return errorResult(
      "nothing_selected",
      "Choose at least one email kind to create.",
    );
  }

  try {
    const runtime = await getStage1WebRuntime();
    const project = await runtime.settings.projects.findById(
      parsed.data.projectId,
    );
    if (project === null) {
      return errorResult("project_not_found", "That project was not found.");
    }

    const selectedKinds = [...new Set(parsed.data.kinds)].filter(
      (kind): kind is (typeof lifecycleKinds)[number] =>
        lifecycleKinds.includes(kind),
    );
    const seeded = await Promise.all(
      selectedKinds.map(async (kind) => {
        const source = await runtime.automatedEmails.findLatestPublishedByKind(
          kind,
          { excludeProjectId: parsed.data.projectId },
        );
        const sourceSubject = source?.publishedSubject;
        const sourceDocument = source?.publishedDoc;
        const draftSeed =
          sourceSubject !== undefined &&
          sourceSubject !== null &&
          sourceDocument !== undefined &&
          sourceDocument !== null
            ? { draftSubject: sourceSubject, draftDoc: sourceDocument }
            : {};

        return runtime.automatedEmails.createTemplate({
          projectId: parsed.data.projectId,
          kind,
          name: kindNames[kind],
          ...draftSeed,
          createdBy: session.id,
        });
      }),
    );
    const custom = parsed.data.includeCustom
      ? [
          await runtime.automatedEmails.createTemplate({
            projectId: parsed.data.projectId,
            kind: "custom",
            name: "Custom automated email",
            createdBy: session.id,
          }),
        ]
      : [];

    revalidateAutomatedEmailViews(parsed.data.projectId);
    return success([...seeded, ...custom].map(serializeTemplate));
  } catch {
    return errorResult(
      "create_templates_failed",
      "The automated email shells could not be created. Try again.",
      true,
    );
  }
}

export async function getAutomatedEmailKindSourcesAction(projectId: string) {
  await requireSession();
  const parsed = projectTargetSchema.safeParse({ projectId });
  if (!parsed.success) {
    return errorResult(
      "validation_error",
      "The template starters could not be loaded.",
    );
  }

  try {
    return success(await loadAutomatedEmailKindSources(parsed.data.projectId));
  } catch {
    return errorResult(
      "kind_sources_failed",
      "The template starters could not be loaded. You can still start blank.",
      true,
    );
  }
}

export async function loadSendLogPageAction(input: {
  readonly projectId: string;
  readonly templateId: string;
  readonly cursor?: string | null;
}) {
  await requireSession();
  const parsed = sendLogPageSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult("validation_error", "The send log could not be loaded.");
  }

  try {
    const page = await loadAutomatedEmailSendLogPage({
      projectId: parsed.data.projectId,
      templateId: parsed.data.templateId,
      ...(parsed.data.cursor === undefined
        ? {}
        : { cursor: parsed.data.cursor }),
    });
    if (page === null) {
      return errorResult(
        "template_not_found",
        "That automated email was not found.",
      );
    }
    return success(page);
  } catch {
    return errorResult(
      "send_log_load_failed",
      "The send log could not be loaded. Try again.",
      true,
    );
  }
}

export async function sendAutomatedEmailNowAction(input: {
  readonly projectId: string;
  readonly templateId: string;
  readonly sendId: string;
}) {
  await requireSession();
  const parsed = sendNowSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult("validation_error", "That send could not be released.");
  }

  const owned = await loadOwnedTemplate(
    parsed.data.projectId,
    parsed.data.templateId,
  );
  if (owned === null) {
    return errorResult(
      "template_not_found",
      "That automated email was not found.",
    );
  }

  try {
    const send = await owned.runtime.automatedEmails.getSendLogRow(
      parsed.data.sendId,
    );
    if (send?.templateId !== owned.template.id) {
      return errorResult("send_not_found", "That send log row was not found.");
    }
    if (send.status !== "held") {
      return errorResult("send_not_held", "Only held sends can be released.");
    }

    const reset = await owned.runtime.automatedEmails.resetHeldSendToReceived(
      send.id,
    );
    if (reset === null) {
      return errorResult(
        "send_not_held",
        "This send is no longer held. Refresh the log and try again.",
      );
    }
    await enqueueAutomatedEmailSendJob({
      runtime: owned.runtime,
      sendId: reset.id,
    });
    revalidateAutomatedEmailViews(parsed.data.projectId);
    return success({ id: reset.id, status: reset.status });
  } catch {
    return errorResult(
      "send_release_failed",
      "The send could not be released. Try again.",
      true,
    );
  }
}

export async function renameTemplateAction(input: {
  readonly projectId: string;
  readonly templateId: string;
  readonly name: string;
}): Promise<UiSuccess<TemplateMutationData> | UiError> {
  await requireSession();
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult("validation_error", "Enter a template name.");
  }

  const owned = await loadOwnedTemplate(
    parsed.data.projectId,
    parsed.data.templateId,
  );
  if (owned === null) {
    return errorResult(
      "template_not_found",
      "That automated email was not found.",
    );
  }

  try {
    const updated = await owned.runtime.automatedEmails.renameTemplate(
      owned.template.id,
      parsed.data.name,
    );
    revalidateAutomatedEmailViews(parsed.data.projectId);
    return success(serializeTemplate(updated));
  } catch {
    return errorResult(
      "rename_failed",
      "The template name could not be saved.",
      true,
    );
  }
}

export async function saveDraftAction(input: {
  readonly projectId: string;
  readonly templateId: string;
  readonly draftSubject: string;
  readonly draftDoc: unknown;
  readonly baselineUpdatedAt: string;
}): Promise<
  | UiSuccess<{
      readonly outcome: "saved";
      readonly template: TemplateMutationData;
    }>
  | UiSuccess<{ readonly outcome: "conflict" }>
  | UiError
> {
  await requireSession();
  const parsed = saveDraftSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      "validation_error",
      "The draft could not be saved. Your changes are still on screen — try again.",
      true,
    );
  }
  const owned = await loadOwnedTemplate(
    parsed.data.projectId,
    parsed.data.templateId,
  );
  if (owned === null) {
    return errorResult(
      "template_not_found",
      "That automated email was not found.",
    );
  }

  try {
    const result = await owned.runtime.automatedEmails.updateDraft(
      parsed.data.templateId,
      {
        draftSubject: parsed.data.draftSubject,
        draftDoc: parsed.data.draftDoc,
        baselineUpdatedAt: parsed.data.baselineUpdatedAt,
      },
    );
    if ("conflict" in result) {
      return success({ outcome: "conflict" });
    }
    revalidateAutomatedEmailViews(parsed.data.projectId);
    return success({ outcome: "saved", template: serializeTemplate(result) });
  } catch {
    return errorResult(
      "save_draft_failed",
      "The draft could not be saved. Try again.",
      true,
    );
  }
}

export async function publishTemplateAction(input: {
  readonly projectId: string;
  readonly templateId: string;
}): Promise<UiSuccess<TemplateMutationData> | UiError> {
  const session = await requireSession();
  const parsed = templateTargetSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      "validation_error",
      "The template could not be published.",
    );
  }
  const owned = await loadOwnedTemplate(
    parsed.data.projectId,
    parsed.data.templateId,
  );
  if (owned === null) {
    return errorResult(
      "template_not_found",
      "That automated email was not found.",
    );
  }

  try {
    const updated = await owned.runtime.automatedEmails.publishTemplate(
      parsed.data.templateId,
      session.id,
    );
    revalidateAutomatedEmailViews(parsed.data.projectId);
    return success(serializeTemplate(updated));
  } catch {
    return errorResult(
      "publish_failed",
      "The template could not be published. Try again.",
      true,
    );
  }
}

export async function setTemplateActiveAction(input: {
  readonly projectId: string;
  readonly templateId: string;
  readonly isActive: boolean;
}): Promise<UiSuccess<TemplateMutationData> | UiError> {
  await requireSession();
  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      "validation_error",
      "The sending setting could not be changed.",
    );
  }
  const owned = await loadOwnedTemplate(
    parsed.data.projectId,
    parsed.data.templateId,
  );
  if (owned === null) {
    return errorResult(
      "template_not_found",
      "That automated email was not found.",
    );
  }

  try {
    const updated = await owned.runtime.automatedEmails.setTemplateActive(
      parsed.data.templateId,
      parsed.data.isActive,
    );
    revalidateAutomatedEmailViews(parsed.data.projectId);
    return success(serializeTemplate(updated));
  } catch {
    return errorResult(
      "set_active_failed",
      "The sending setting could not be changed. Try again.",
      true,
    );
  }
}

export async function renderPreviewAction(input: {
  readonly projectId: string;
  readonly templateId: string;
  readonly draftSubject: string;
  readonly draftDoc: unknown;
  readonly samplePerson: "nico" | "selah";
}): Promise<UiSuccess<PreviewData> | UiError> {
  await requireSession();
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(
      "validation_error",
      "The preview could not be rendered.",
    );
  }
  const rendered = await renderDraft(parsed.data);
  return rendered.ok ? success(rendered.data) : rendered.error;
}

export async function sendTestAction(input: {
  readonly projectId: string;
  readonly templateId: string;
  readonly draftSubject: string;
  readonly draftDoc: unknown;
  readonly samplePerson: "nico" | "selah";
  readonly recipientEmail: string;
}): Promise<UiSuccess<{ readonly recipientEmail: string }> | UiError> {
  const session = await requireSession();
  const parsed = sendTestSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult("validation_error", "Enter a valid test email address.");
  }
  const rendered = await renderDraft(parsed.data);
  if (!rendered.ok) {
    return rendered.error;
  }

  const postmark = getAutomatedEmailTestSendRuntime();
  if (postmark === null) {
    return errorResult(
      "test_send_unavailable",
      "Postmark is not configured for test sends in this environment.",
    );
  }

  try {
    const result = await postmark.client.sendBatch({
      messages: [
        {
          From: `Adventure Scientists <${rendered.data.fromEmail}>`,
          To: parsed.data.recipientEmail,
          ReplyTo: rendered.data.fromEmail,
          Subject: `[Test] ${rendered.data.subject}`,
          HtmlBody: rendered.data.html,
          TextBody: rendered.data.text,
          MessageStream: postmark.transactionalStreamId,
          Metadata: {
            automatedEmailTemplateId: parsed.data.templateId,
            automatedEmailType: "test",
            operatorUserId: session.id,
          },
        },
      ],
    });
    if (result.results[0]?.ErrorCode !== 0) {
      return errorResult(
        "test_send_rejected",
        "Postmark could not send this test email. Check the project sender and try again.",
      );
    }

    return success({ recipientEmail: parsed.data.recipientEmail });
  } catch {
    return errorResult(
      "test_send_failed",
      "The test email could not be sent. Try again.",
      true,
    );
  }
}
