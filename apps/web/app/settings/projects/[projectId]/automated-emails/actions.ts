"use server";

import { randomUUID } from "node:crypto";

import {
  automatedEmailKindSchema,
  type AutomatedEmailKind,
} from "@as-comms/contracts";
import { renderAutomatedEmail } from "@as-comms/domain";
import { z } from "zod";

import type { UiError, UiSuccess } from "@/src/server/ui-result";
import { requireSession } from "@/src/server/auth/session";
import { getAutomatedEmailTestSendRuntime } from "@/src/server/automated-email/postmark-test-send";
import { revalidateAutomatedEmailViews } from "@/src/server/settings/revalidate";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";
import { loadAutomatedEmailKindSources } from "@/src/server/automated-email/selectors";

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

const automatedEmailDocumentSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.unknown()).optional(),
  })
  .passthrough();

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

const samplePeople = {
  nico: {
    firstName: "Nico",
    lastName: "Ortiz",
    email: "nico.ortiz@gmail.com",
  },
  selah: {
    firstName: "Selah",
    lastName: "Whitcomb",
    email: "selah.w@fastmail.com",
  },
} as const;

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
      values: {
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email,
        projectName: project.projectName,
      },
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
  } catch {
    return {
      ok: false,
      error: errorResult(
        "draft_render_failed",
        "This draft cannot be rendered. Check its merge fields and formatting, then try again.",
      ),
    };
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
    return errorResult("validation_error", "The draft could not be saved.");
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
