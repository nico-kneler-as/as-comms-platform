"use server";

import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { composerSendInputSchema } from "@as-comms/contracts";
import {
  CanonicalContactAmbiguityError,
  canSendTo,
  computePendingComposerOutboundFingerprint,
  maskKnowledgeExample,
  smsMetrics,
  toE164,
} from "@as-comms/domain";
import { requireSession } from "@/src/server/auth/session";
import {
  sendComposerGmailMessage,
  type GmailSendError,
} from "@/src/server/composer/gmail-send";
import { sendSmsViaTwilio } from "@/src/server/composer/twilio-send";
import {
  aiDraftRequestSchema,
  generateAiDraft,
  type AiDraftRequestPayload,
  type AiDraftResponse,
} from "@/src/server/ai";
import { enqueueSynthesizeProjectKnowledgeJob } from "@/src/server/ai/enqueue";
import { getAiProviderConfig } from "@/src/server/ai/provider";
import { readWebEnv } from "@/src/server/env";
import { setInboxArchived } from "@/src/server/inbox/archive";
import { setInboxBucket } from "@/src/server/inbox/bucket";

export type { AiDraftRequestPayload } from "@/src/server/ai";
import { setInboxNeedsFollowUp } from "@/src/server/inbox/follow-up";
import { revalidateInboxContact } from "@/src/server/inbox/revalidate";
import {
  getInternalNoteValidationError,
  normalizeInternalNoteBody,
} from "@/src/lib/internal-note-validation";
import { appendComposerHtmlSignature } from "@/src/lib/html-sanitizer";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";
import { appendSecurityAudit } from "@/src/server/security/audit";
import { enforceRateLimit } from "@/src/server/security/rate-limit";

import type { MetricKey } from "./_lib/project-lifecycle-metrics";
import type { UiResult } from "../../src/server/ui-result";

const SMS_AI_MAX_TOKENS = 120;

/**
 * Phase 3 of PRD #366 — automatic AI Knowledge re-synthesis trigger.
 *
 * After this many "Send and save for AI" approvals accumulate for a project
 * (since the last successful synthesis, or all-time if synthesis has never
 * run), the inbox capture path enqueues a synthesis worker job so the
 * AI's drafts continuously incorporate the operator's best work. Hardcoded
 * for now; a future PR can make this per-project configurable.
 */
const AI_KNOWLEDGE_CAPTURE_TRIGGER_THRESHOLD = 5;

const composerSendActionInputSchema = composerSendInputSchema.extend({
  saveAsKnowledge: z.boolean().optional(),
  captureAsKnowledge: z.boolean().optional().default(false),
  clientGeneratedId: z.string().min(1).optional(),
});

type ComposerSendActionParsedInput = z.output<
  typeof composerSendActionInputSchema
>;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type FollowUpActionData = {
  readonly contactId: string;
  readonly needsFollowUp: boolean;
};

export type FollowUpActionResult = UiResult<FollowUpActionData>;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type InboxBucketActionData = {
  readonly contactId: string;
  readonly bucket: "New" | "Opened";
};

export type InboxBucketActionResult = UiResult<InboxBucketActionData>;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type InboxArchiveActionData = {
  readonly contactId: string;
};

export type InboxArchiveActionResult = UiResult<InboxArchiveActionData>;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type ComposerSendActionData = {
  readonly pendingOutboundId: string;
  readonly canonicalContactId: string;
  readonly threadId: string | null;
  readonly clientGeneratedId: string | null;
};

export type ComposerSendActionInput = z.input<
  typeof composerSendActionInputSchema
>;
export type ComposerSendActionResult = UiResult<ComposerSendActionData>;

const smsRecipientSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("contact"),
    contactId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("phone"),
    phoneE164: z.string().min(1),
  }),
]);

const sendSmsActionInputSchema = z.object({
  recipient: smsRecipientSchema,
  senderId: z.string().min(1),
  body: z.string().min(1),
  clientGeneratedId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  saveAsKnowledge: z.boolean().optional(),
});

export type SendSmsActionInput = z.input<typeof sendSmsActionInputSchema>;
export type SendSmsActionResult =
  | {
      readonly ok: true;
      readonly data: {
        readonly messageId: string;
        readonly clientGeneratedId: string;
      };
    }
  | {
      readonly ok: false;
      readonly code:
        | "validation_error"
        | "feature_disabled"
        | "consent_denied"
        | "twilio_error"
        | "unknown_error";
      readonly message: string;
      readonly retryable?: boolean;
    };

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type NoteCreateActionData = {
  readonly noteId: string;
  readonly contactId: string;
};

export type NoteCreateActionResult = UiResult<NoteCreateActionData>;
export type NoteUpdateActionResult = UiResult<{
  readonly noteId: string;
}>;
export type NoteDeleteActionResult = UiResult<{
  readonly noteId: string;
}>;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type ContactSearchResult = {
  readonly id: string;
  readonly displayName: string;
  readonly primaryEmail: string | null;
  readonly primaryPhone: string | null;
  readonly salesforceContactId: string | null;
  readonly primaryProjectName: string | null;
};

export type ContactSearchActionResult = UiResult<
  readonly ContactSearchResult[]
>;
export type AiDraftResponseVm = AiDraftResponse;
export type DraftWithAiActionResult = UiResult<AiDraftResponseVm>;

export type ProjectMetricKey = MetricKey;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type ProjectMetricContactRow = {
  readonly contactId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly occurredAt: string;
};

type AiDraftFailureClassification =
  | { readonly kind: "misconfigured" }
  | { readonly kind: "unexpected" };

interface AiDraftConcurrencyState {
  readonly counts: Map<string, number>;
}

interface ProjectMetricContactSqlRow {
  readonly contactId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly occurredAt: Date | string;
}

declare global {
  var __AS_COMMS_AI_DRAFT_CONCURRENCY__: AiDraftConcurrencyState | undefined;
}

const PROJECT_METRIC_EVENT_TYPE: Readonly<Record<ProjectMetricKey, string>> = {
  signups: "lifecycle.signed_up",
  trainingCompletions: "lifecycle.completed_training",
  dataSubmissions: "lifecycle.submitted_first_data",
};
const MS_PER_DAY = 24 * 60 * 60 * 1_000;

function describeComposerSendError(error: GmailSendError): string {
  if ("detail" in error) {
    return error.detail;
  }
  switch (error.kind) {
    case "send_as_not_authorized":
      return `Gmail rejected send-as for alias "${error.alias}".`;
    case "attachment_too_large":
      return `Total attachment bytes ${String(error.totalBytes)} exceeds Gmail limit.`;
    case "rate_limited":
      return error.retryAfterSeconds === null
        ? "Gmail rate-limited; retry-after not provided."
        : `Gmail rate-limited; retry after ${String(error.retryAfterSeconds)}s.`;
  }
}

function getAiDraftConcurrencyState(): AiDraftConcurrencyState {
  globalThis.__AS_COMMS_AI_DRAFT_CONCURRENCY__ ??= {
    counts: new Map<string, number>(),
  };

  return globalThis.__AS_COMMS_AI_DRAFT_CONCURRENCY__;
}

function normalizeSqlResultRows(result: unknown): readonly unknown[] {
  // postgres-js (drizzle-orm/postgres-js, used in production) returns a
  // plain array; node-pg / pglite return { rows: [...] }.
  if (Array.isArray(result)) {
    return result;
  }

  if (
    typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray(result.rows)
  ) {
    return result.rows;
  }

  return [];
}

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function mapProjectMetricContactRow(
  row: ProjectMetricContactSqlRow,
): ProjectMetricContactRow | null {
  const occurredAt = toValidDate(row.occurredAt);

  if (occurredAt === null) {
    return null;
  }

  const name = row.name?.trim() ?? "";
  const email = row.email?.trim() ?? "";

  return {
    contactId: row.contactId,
    name: name.length > 0 ? name : null,
    email: email.length > 0 ? email : null,
    occurredAt: occurredAt.toISOString(),
  };
}

async function captureKnowledgeFromSend(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly projectId: string;
  readonly bodyPlaintext: string;
  readonly createdAt: Date;
  readonly createdByUserId: string;
  readonly source:
    | {
        readonly channel: "email";
        readonly subject: string;
        readonly pendingOutboundId: string;
        readonly gmailMessageId: string;
        readonly gmailThreadId: string | null;
        readonly rfc822MessageId: string | null;
      }
    | {
        readonly channel: "sms";
        readonly smsMessageId: string;
        readonly twilioMessageSid: string | null;
        readonly summary: string;
      };
}): Promise<void> {
  const nowIso = input.createdAt.toISOString();
  const questionSummary =
    input.source.channel === "email"
      ? input.source.subject
      : input.source.summary;
  const entryId =
    input.source.channel === "email"
      ? `project_knowledge:captured:${input.source.pendingOutboundId}`
      : `project_knowledge:captured:${input.source.smsMessageId}`;
  const metadataJson =
    input.source.channel === "email"
      ? {
          subject: input.source.subject,
          bodyPlaintext: input.bodyPlaintext,
          createdByUserId: input.createdByUserId,
          pendingOutboundId: input.source.pendingOutboundId,
          gmailMessageId: input.source.gmailMessageId,
          gmailThreadId: input.source.gmailThreadId,
          rfc822MessageId: input.source.rfc822MessageId,
          maskedExample: maskKnowledgeExample(input.bodyPlaintext),
        }
      : {
          channel: "sms" as const,
          bodyPlaintext: input.bodyPlaintext,
          createdByUserId: input.createdByUserId,
          smsMessageId: input.source.smsMessageId,
          twilioMessageSid: input.source.twilioMessageSid,
          maskedExample: maskKnowledgeExample(input.bodyPlaintext),
        };

  // Phase 3 of PRD #366: the operator's deliberate click on
  // "Send and save for AI" IS the approval signal. The original spec assumed
  // a separate review step (approvedForAi: false then a UI gate flips it),
  // but that review UI was never built and is deferred to a later PRD. Per
  // D-032 ("memory captured ONLY from human-approved sent replies"), this
  // is consistent — the click is the human approval. Captures land
  // approved-for-AI immediately and feed straight into synthesis weighting.
  await input.runtime.repositories.projectKnowledge.upsert({
    id: entryId,
    projectId: input.projectId,
    kind: "canonical_reply",
    issueType: null,
    volunteerStage: null,
    questionSummary,
    replyStrategy: null,
    // The column is named masked_example for a reason; the synthesis path
    // and prompt builder both read from it expecting masked PII. Storing
    // the raw body here was a long-standing miss — fixed 2026-05-10.
    maskedExample: maskKnowledgeExample(input.bodyPlaintext),
    sourceKind: "captured_from_send",
    approvedForAi: true,
    sourceEventId: null,
    metadataJson,
    lastReviewedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  await maybeTriggerCaptureBasedSynthesis({
    runtime: input.runtime,
    projectId: input.projectId,
  });
}

/**
 * Phase 3 capture-trigger: after a successful "Send and save for AI" capture
 * upsert, count how many approved-for-AI rows have accumulated since the
 * last synthesis (or all-time if synthesis has never run). Once we cross
 * the threshold AND the project has at least one enabled AI Knowledge
 * source, enqueue the synthesis worker job.
 *
 * Failures here are logged but never thrown — the original Send-and-save
 * action must remain successful even if the trigger queue is unavailable.
 */
async function maybeTriggerCaptureBasedSynthesis(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly projectId: string;
}): Promise<void> {
  try {
    const project =
      await input.runtime.repositories.projectDimensions.findById(
        input.projectId,
      );
    if (project === null) {
      return;
    }

    const lastSynthesizedAt = project.aiOptimizedSynthesizedAt;
    const sinceDate =
      typeof lastSynthesizedAt === "string" && lastSynthesizedAt.length > 0
        ? new Date(lastSynthesizedAt)
        : null;
    const sinceForCount =
      sinceDate !== null && Number.isFinite(sinceDate.getTime())
        ? sinceDate
        : null;

    const approvedCount =
      await input.runtime.repositories.projectKnowledge.countCapturedSinceTimestamp(
        {
          projectId: input.projectId,
          since: sinceForCount,
        },
      );

    if (approvedCount < AI_KNOWLEDGE_CAPTURE_TRIGGER_THRESHOLD) {
      return;
    }

    const sources =
      await input.runtime.repositories.projectDimensions.getAiKnowledgeSources(
        input.projectId,
      );
    const hasEnabledSource = sources.some((source) => source.enabled);
    if (!hasEnabledSource) {
      return;
    }

    await enqueueSynthesizeProjectKnowledgeJob({
      runtime: input.runtime,
      projectId: input.projectId,
      trigger: "capture_threshold",
      // Approved-reply additions aren't part of the source-input hash — we
      // explicitly want to re-synthesize even when Notion sources haven't
      // changed because the new captures ARE the change signal.
      skipIfHashUnchanged: false,
      jobKey: `ai-knowledge-capture-trigger:${input.projectId}`,
    });
  } catch (error) {
    console.warn(
      "Capture-triggered AI knowledge synthesis enqueue failed; capture itself succeeded.",
      {
        projectId: input.projectId,
        error,
      },
    );
  }
}

function readSaveAsKnowledgeFlag(
  input: {
    readonly saveAsKnowledge?: boolean | undefined;
    readonly captureAsKnowledge?: boolean | undefined;
  },
): boolean {
  return input.saveAsKnowledge ?? input.captureAsKnowledge ?? false;
}

function beginAiDraftRequest(userId: string): boolean {
  const state = getAiDraftConcurrencyState();
  const current = state.counts.get(userId) ?? 0;

  if (current >= 3) {
    return false;
  }

  state.counts.set(userId, current + 1);
  return true;
}

function endAiDraftRequest(userId: string): void {
  const state = getAiDraftConcurrencyState();
  const current = state.counts.get(userId);

  if (current === undefined || current <= 1) {
    state.counts.delete(userId);
    return;
  }

  state.counts.set(userId, current - 1);
}

function readErrorProperty(
  error: unknown,
  property: "cause" | "code" | "message" | "name",
): unknown {
  if (typeof error !== "object" || error === null || !(property in error)) {
    return undefined;
  }

  return (error as Record<typeof property, unknown>)[property];
}

function readErrorCode(error: unknown): string | undefined {
  const code = readErrorProperty(error, "code");

  return typeof code === "string" ? code : undefined;
}

function readErrorStringProperty(
  error: unknown,
  property: "message" | "name",
): string | undefined {
  const value = readErrorProperty(error, property);

  return typeof value === "string" ? value : undefined;
}

function classifyAiDraftFailure(error: unknown): AiDraftFailureClassification {
  const cause = readErrorProperty(error, "cause");
  const code = readErrorCode(cause) ?? readErrorCode(error);
  const name = readErrorStringProperty(error, "name");
  const message = readErrorStringProperty(error, "message") ?? "";
  const lowerMessage = message.toLowerCase();

  if (
    code === "42P01" ||
    code === "42703" ||
    code === "3F000" ||
    name === "AiProviderNotConfiguredError" ||
    lowerMessage.includes("anthropic_api_key") ||
    lowerMessage.includes("ai provider")
  ) {
    return { kind: "misconfigured" };
  }

  return { kind: "unexpected" };
}

function buildAiDraftFailureLogFields(error: unknown, requestId: string) {
  const cause = readErrorProperty(error, "cause");
  const code = readErrorCode(error) ?? readErrorCode(cause);
  const name = readErrorStringProperty(error, "name");
  const message = readErrorStringProperty(error, "message");

  return {
    requestId,
    code,
    name,
    message: message === undefined ? undefined : message.slice(0, 200),
  };
}

function unauthorizedError(requestId: string): UiResult<never> {
  return {
    ok: false,
    code: "unauthorized",
    message: "Your session has expired. Please sign in again.",
    requestId,
  };
}

function followUpRateLimitError(requestId: string): FollowUpActionResult {
  return {
    ok: false,
    code: "rate_limit_exceeded",
    message: "Too many follow-up updates. Please wait a minute and try again.",
    requestId,
    retryable: true,
  };
}

function bucketRateLimitError(requestId: string): InboxBucketActionResult {
  return {
    ok: false,
    code: "rate_limit_exceeded",
    message: "Too many read-state changes. Please wait a minute and try again.",
    requestId,
    retryable: true,
  };
}

function archiveRateLimitError(requestId: string): InboxArchiveActionResult {
  return {
    ok: false,
    code: "rate_limit_exceeded",
    message: "Too many archive changes. Please wait a minute and try again.",
    requestId,
    retryable: true,
  };
}

function composerRateLimitError(requestId: string): ComposerSendActionResult {
  return {
    ok: false,
    code: "rate_limit_exceeded",
    message: "Too many composer sends. Please wait a minute and try again.",
    requestId,
    retryable: true,
  };
}

function contactSearchRateLimitError(
  requestId: string,
): ContactSearchActionResult {
  return {
    ok: false,
    code: "rate_limit_exceeded",
    message: "Too many contact searches. Please wait a minute and try again.",
    requestId,
    retryable: true,
  };
}

function noteCreateRateLimitError(requestId: string): NoteCreateActionResult {
  return {
    ok: false,
    code: "rate_limit_exceeded",
    message: "Too many note saves. Please wait a minute and try again.",
    requestId,
    retryable: true,
  };
}

function noteUpdateRateLimitError(requestId: string): NoteUpdateActionResult {
  return {
    ok: false,
    code: "rate_limit_exceeded",
    message: "Too many note edits. Please wait a minute and try again.",
    requestId,
    retryable: true,
  };
}

function noteDeleteRateLimitError(requestId: string): NoteDeleteActionResult {
  return {
    ok: false,
    code: "rate_limit_exceeded",
    message: "Too many note deletes. Please wait a minute and try again.",
    requestId,
    retryable: true,
  };
}

function composerValidationError(
  requestId: string,
  input: {
    readonly message: string;
    readonly fieldErrors?: Record<string, string>;
  },
): ComposerSendActionResult {
  return {
    ok: false,
    code: "validation_error",
    message: input.message,
    requestId,
    retryable: false,
    ...(input.fieldErrors === undefined
      ? {}
      : { fieldErrors: input.fieldErrors }),
  };
}

function aiDraftValidationError(
  requestId: string,
  input: {
    readonly message: string;
    readonly fieldErrors?: Record<string, string>;
  },
): DraftWithAiActionResult {
  return {
    ok: false,
    code: "validation_error",
    message: input.message,
    requestId,
    retryable: false,
    ...(input.fieldErrors === undefined
      ? {}
      : { fieldErrors: input.fieldErrors }),
  };
}

function noteValidationError(
  requestId: string,
  input: {
    readonly message: string;
    readonly fieldErrors?: Record<string, string>;
  },
): UiResult<never> {
  return {
    ok: false,
    code: "validation_error",
    message: input.message,
    requestId,
    retryable: false,
    ...(input.fieldErrors === undefined
      ? {}
      : { fieldErrors: input.fieldErrors }),
  };
}

function noteForbiddenError(requestId: string): UiResult<never> {
  return {
    ok: false,
    code: "forbidden",
    message: "You can only edit or delete your own notes.",
    requestId,
    retryable: false,
  };
}

function noteNotFoundError(requestId: string): UiResult<never> {
  return {
    ok: false,
    code: "not_found",
    message: "That note could not be found.",
    requestId,
    retryable: false,
  };
}

function composerGenericRetryableError(
  requestId: string,
): ComposerSendActionResult {
  return {
    ok: false,
    code: "send_failed",
    message: "We could not send that email right now. Please try again.",
    requestId,
    retryable: true,
  };
}

function mapComposerProviderError(
  requestId: string,
  kind:
    | "auth_error"
    | "scope_error"
    | "send_as_not_authorized"
    | "invalid_recipient"
    | "attachment_too_large"
    | "rate_limited"
    | "transient"
    | "permanent",
): ComposerSendActionResult {
  switch (kind) {
    case "auth_error":
    case "scope_error":
      return {
        ok: false,
        code: "composer_unavailable",
        message: "Email sending is unavailable right now.",
        requestId,
        retryable: false,
      };
    case "send_as_not_authorized":
      return {
        ok: false,
        code: "alias_not_authorized",
        message: "That alias is not authorized for Gmail send-as.",
        requestId,
        retryable: false,
      };
    case "invalid_recipient":
      return {
        ok: false,
        code: "invalid_recipient",
        message: "The recipient email address is invalid.",
        requestId,
        retryable: false,
      };
    case "attachment_too_large":
      return {
        ok: false,
        code: "attachment_too_large",
        message: "The attachments exceed Gmail's size limit.",
        requestId,
        retryable: false,
      };
    case "rate_limited":
      return {
        ok: false,
        code: "provider_rate_limited",
        message: "Gmail rate limited the send. Please retry shortly.",
        requestId,
        retryable: true,
      };
    case "transient":
      return {
        ok: false,
        code: "provider_transient",
        message: "Gmail could not complete the send. Please retry.",
        requestId,
        retryable: true,
      };
    case "permanent":
      return {
        ok: false,
        code: "send_failed",
        message: "Gmail rejected the send request.",
        requestId,
        retryable: false,
      };
  }
}

function readContactId(formData: FormData): string | null {
  const value = formData.get("contactId");
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeEmailAddress(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 ? null : normalized;
}

function normalizeEmailAddresses(values: readonly string[] | undefined): string[] {
  return (values ?? []).flatMap((value) => {
    const normalized = normalizeEmailAddress(value);
    return normalized === null ? [] : [normalized];
  });
}

function resolveCurrentUserDisplayName(input: {
  readonly name: string | null | undefined;
  readonly email: string | null | undefined;
}): string {
  const trimmedName = input.name?.trim();

  if (trimmedName && trimmedName.length > 0) {
    return trimmedName;
  }

  const localPart = input.email?.split("@", 1)[0]?.trim();

  if (localPart && localPart.length > 0) {
    return localPart;
  }

  return "Internal note";
}

async function resolveInternalNoteContactId(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly noteId: string;
}): Promise<string | null> {
  const note = await input.runtime.repositories.internalNotes.findById(
    input.noteId,
  );

  return note?.contactId ?? null;
}

function normalizeMembershipStatus(value: string | null): string {
  return (value ?? "").trim().toLowerCase().replaceAll("_", "-");
}

function membershipSortRank(membershipStatus: string | null): number {
  switch (normalizeMembershipStatus(membershipStatus)) {
    case "lead":
      return 0;
    case "applied":
    case "applicant":
      return 1;
    case "in-training":
    case "training":
      return 2;
    case "trip-planning":
      return 3;
    case "in-field":
    case "active":
      return 4;
    case "successful":
    case "completed":
      return 5;
    default:
      return 6;
  }
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readAliasSignature(aliasRecord: Record<string, unknown>): string {
  const signature = aliasRecord.signature;
  return typeof signature === "string" && signature.trim().length > 0
    ? signature
    : "";
}

function appendSignature(bodyPlaintext: string, signature: string): string {
  return signature.length > 0
    ? `${bodyPlaintext}\n\n${signature}`
    : bodyPlaintext;
}

function buildAttachmentMetadata(
  attachments: ComposerSendActionParsedInput["attachments"],
) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    size: Buffer.from(attachment.contentBase64, "base64").length,
    contentType: attachment.contentType,
  }));
}

export async function loadProjectMetricContacts(input: {
  readonly projectId: string;
  readonly metricKey: ProjectMetricKey;
}): Promise<{ readonly rows: readonly ProjectMetricContactRow[] }> {
  await requireSession();

  const runtime = await getStage1WebRuntime();
  const [project] = await runtime.repositories.projectDimensions.listByIds([
    input.projectId,
  ]);

  if (project?.isActive !== true || runtime.connection === null) {
    return { rows: [] };
  }

  const now = new Date();
  const todayStart = startOfUtcDay(now);
  const windowStart = new Date(todayStart.getTime() - 6 * MS_PER_DAY);
  const windowEndExclusive = new Date(todayStart.getTime() + MS_PER_DAY);
  const eventType = PROJECT_METRIC_EVENT_TYPE[input.metricKey];
  const result = await runtime.connection.db.execute(
    sql<ProjectMetricContactSqlRow>`
      with deduped_contacts as (
        select
          cel.contact_id as "contactId",
          min(cel.occurred_at) as "occurredAt"
        from canonical_event_ledger cel
        inner join contact_memberships cm
          on cm.contact_id = cel.contact_id
         and cm.project_id = ${input.projectId}
        where cel.event_type::text = ${eventType}
          and cel.occurred_at >= ${windowStart.toISOString()}
          and cel.occurred_at < ${windowEndExclusive.toISOString()}
        group by cel.contact_id
      )
      select
        dc."contactId" as "contactId",
        c.display_name as "name",
        c.primary_email as "email",
        dc."occurredAt" as "occurredAt"
      from deduped_contacts dc
      inner join contacts c
        on c.id = dc."contactId"
      order by dc."occurredAt" desc, dc."contactId" asc
    `,
  );

  return {
    rows: normalizeSqlResultRows(result)
      .map((row) => mapProjectMetricContactRow(row as ProjectMetricContactSqlRow))
      .filter((row): row is ProjectMetricContactRow => row !== null),
  };
}

export async function searchContactsAction(
  query: string,
): Promise<ContactSearchActionResult> {
  const requestId = randomUUID();

  let currentUser;
  try {
    currentUser = await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return unauthorizedError(requestId);
    }
    throw error;
  }

  const decision = await enforceRateLimit({
    scope: "server-action:inbox-contact-search",
    identifier: currentUser.id,
    limit: 60,
    audit: {
      actorType: "user",
      actorId: currentUser.id,
      action: "inbox.contact_search.rate_limited",
      entityType: "server_action",
      entityId: "inbox.contact_search",
      metadataJson: {
        queryLength: query.trim().length,
      },
    },
  });

  if (!decision.allowed) {
    return contactSearchRateLimitError(requestId);
  }

  const runtime = await getStage1WebRuntime();
  const contacts = await runtime.repositories.contacts.searchByQuery({
    query,
    limit: 8,
  });

  if (contacts.length === 0) {
    return {
      ok: true,
      data: [],
      requestId,
    };
  }

  const contactIds = contacts.map((contact) => contact.id);
  const memberships =
    await runtime.repositories.contactMemberships.listByContactIds(contactIds);
  const projectIds = Array.from(
    new Set(
      memberships
        .map((membership) => membership.projectId)
        .filter((projectId): projectId is string => projectId !== null),
    ),
  );
  const projectDimensions =
    await runtime.repositories.projectDimensions.listByIds(projectIds);
  const membershipsByContactId = new Map<
    string,
    (typeof memberships)[number][]
  >();

  for (const membership of memberships) {
    const existing = membershipsByContactId.get(membership.contactId);

    if (existing === undefined) {
      membershipsByContactId.set(membership.contactId, [membership]);
      continue;
    }

    existing.push(membership);
  }

  const projectNameById = new Map(
    projectDimensions.map((project) => [
      project.projectId,
      project.projectName,
    ]),
  );

  return {
    ok: true,
    data: contacts.map((contact) => {
      const primaryMembership =
        [...(membershipsByContactId.get(contact.id) ?? [])].sort(
          (left, right) => {
            const rankDifference =
              membershipSortRank(left.status) -
              membershipSortRank(right.status);

            if (rankDifference !== 0) {
              return rankDifference;
            }

            if (left.projectId !== right.projectId) {
              return (left.projectId ?? "").localeCompare(
                right.projectId ?? "",
              );
            }

            return left.id.localeCompare(right.id);
          },
        )[0] ?? null;

      return {
        id: contact.id,
        displayName: contact.displayName,
        primaryEmail: contact.primaryEmail,
        primaryPhone: contact.primaryPhone,
        salesforceContactId: contact.salesforceContactId,
        primaryProjectName:
          primaryMembership?.projectId === null || primaryMembership === null
            ? null
            : (projectNameById.get(primaryMembership.projectId) ?? null),
      };
    }),
    requestId,
  };
}

async function resolveContactEmail(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly contactId: string;
}): Promise<string | null> {
  const contact = await input.runtime.repositories.contacts.findById(
    input.contactId,
  );

  if (contact === null) {
    return null;
  }

  const normalizedPrimaryEmail =
    contact.primaryEmail === null
      ? null
      : normalizeEmailAddress(contact.primaryEmail);

  if (normalizedPrimaryEmail !== null) {
    return normalizedPrimaryEmail;
  }

  const identities =
    await input.runtime.repositories.contactIdentities.listByContactId(
      contact.id,
    );

  return (
    identities.find((identity) => identity.kind === "email")?.normalizedValue ??
    null
  );
}

async function resolveContactPhone(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly contactId: string;
}): Promise<string | null> {
  const contact = await input.runtime.repositories.contacts.findById(
    input.contactId,
  );

  if (contact === null) {
    return null;
  }

  if (contact.primaryPhone !== null) {
    return contact.primaryPhone;
  }

  const identities =
    await input.runtime.repositories.contactIdentities.listByContactId(
      contact.id,
    );

  return (
    identities.find((identity) => identity.kind === "phone")?.normalizedValue ??
    null
  );
}

async function resolveSmsConsentDecision(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly contactId: string | null;
  readonly phoneE164: string;
}) {
  const [phoneConsent, contactConsent, hasPriorInbound] = await Promise.all([
    input.runtime.repositories.consentRecords.findLatestByPhone(input.phoneE164),
    input.contactId === null
      ? Promise.resolve(null)
      : input.runtime.repositories.consentRecords.findLatestByContact(
          input.contactId,
        ),
    input.runtime.repositories.smsMessages.hasInboundForPhone(input.phoneE164),
  ]);

  const latestConsent =
    contactConsent === null
      ? phoneConsent
      : phoneConsent === null
        ? contactConsent
        : contactConsent.createdAt >= phoneConsent.createdAt
          ? contactConsent
          : phoneConsent;

  return canSendTo({
    latestConsent,
    hasPriorInbound,
  });
}

async function ensureCanonicalContactForPhone(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly phoneE164: string;
  readonly occurredAtIso: string;
}) {
  const identities =
    await input.runtime.repositories.contactIdentities.listByNormalizedValue({
      kind: "phone",
      normalizedValue: input.phoneE164,
    });
  const contactIds = Array.from(new Set(identities.map((identity) => identity.contactId)));

  if (contactIds.length > 1) {
    throw new Error(`Multiple contacts already own phone ${input.phoneE164}.`);
  }

  const existingContactId = contactIds[0];
  if (existingContactId !== undefined) {
    return existingContactId;
  }

  const contactId = `contact:phone:${input.phoneE164}`;
  await input.runtime.repositories.contacts.upsert({
    id: contactId,
    salesforceContactId: null,
    displayName: input.phoneE164,
    primaryEmail: null,
    primaryPhone: input.phoneE164,
    createdAt: input.occurredAtIso,
    updatedAt: input.occurredAtIso,
  });
  await input.runtime.repositories.contactIdentities.upsert({
    id: `contact-identity:${contactId}:phone:${input.phoneE164}`,
    contactId,
    kind: "phone",
    normalizedValue: input.phoneE164,
    isPrimary: true,
    source: "manual",
    verifiedAt: input.occurredAtIso,
  });

  return contactId;
}

export async function resolveSmsConsentAction(rawInput: {
  readonly recipient:
    | {
        readonly kind: "contact";
        readonly contactId: string;
      }
    | {
        readonly kind: "phone";
        readonly phoneE164: string;
      };
}): Promise<{
  readonly ok: boolean;
  readonly data?: {
    readonly canSend: boolean;
    readonly reason: "no_consent" | "revoked" | null;
  };
}> {
  try {
    await requireSession();
  } catch {
    return {
      ok: true,
      data: {
        canSend: false,
        reason: "no_consent",
      },
    };
  }

  const runtime = await getStage1WebRuntime();
  const resolvedPhone =
    rawInput.recipient.kind === "contact"
      ? await resolveContactPhone({
          runtime,
          contactId: rawInput.recipient.contactId,
        })
      : toE164(rawInput.recipient.phoneE164);

  if (resolvedPhone === null) {
    return {
      ok: true,
      data: {
        canSend: false,
        reason: "no_consent",
      },
    };
  }

  const decision = await resolveSmsConsentDecision({
    runtime,
    contactId:
      rawInput.recipient.kind === "contact"
        ? rawInput.recipient.contactId
        : null,
    phoneE164: resolvedPhone,
  });

  return {
    ok: true,
    data: {
      canSend: decision.canSend,
      reason: decision.canSend ? null : decision.reason,
    },
  };
}

export async function sendSmsAction(
  rawInput: SendSmsActionInput,
): Promise<SendSmsActionResult> {
  const env = readWebEnv();

  if (!env.SMS_ENABLED) {
    return {
      ok: false,
      code: "feature_disabled",
      message: "SMS is not enabled.",
    };
  }

  const parsedInput = sendSmsActionInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    return {
      ok: false,
      code: "validation_error",
      message: "SMS send input is invalid.",
    };
  }
  const saveAsKnowledge = readSaveAsKnowledgeFlag(parsedInput.data);
  const knowledgeProjectId = parsedInput.data.projectId ?? null;

  let currentUser;
  try {
    currentUser = await requireSession();
  } catch {
    return {
      ok: false,
      code: "unknown_error",
      message: "Your session has expired. Please sign in again.",
    };
  }

  const runtime = await getStage1WebRuntime();
  const attemptedAt = new Date();
  const attemptedAtIso = attemptedAt.toISOString();
  const sender = await runtime.repositories.smsSenders.findById(
    parsedInput.data.senderId,
  );

  if (sender?.isActive !== true) {
    return {
      ok: false,
      code: "validation_error",
      message: "The selected SMS sender is not configured.",
      retryable: false,
    };
  }

  const body = parsedInput.data.body.trim();
  if (body.length === 0) {
    return {
      ok: false,
      code: "validation_error",
      message: "SMS body is required.",
      retryable: false,
    };
  }

  const metrics = smsMetrics(body);
  if (metrics.segments > 10) {
    return {
      ok: false,
      code: "validation_error",
      message: "SMS messages are limited to 10 segments.",
      retryable: false,
    };
  }

  let phoneE164: string | null;
  let contactId: string | null;

  if (parsedInput.data.recipient.kind === "contact") {
    contactId = parsedInput.data.recipient.contactId;
    phoneE164 = await resolveContactPhone({
      runtime,
      contactId,
    });
  } else {
    phoneE164 = toE164(parsedInput.data.recipient.phoneE164);
    contactId = null;
  }

  if (phoneE164 === null) {
    return {
      ok: false,
      code: "validation_error",
      message: "A valid recipient phone number is required.",
      retryable: false,
    };
  }

  const consentDecision = await resolveSmsConsentDecision({
    runtime,
    contactId,
    phoneE164,
  });

  if (!consentDecision.canSend) {
    return {
      ok: false,
      code: "consent_denied",
      message:
        consentDecision.reason === "revoked"
          ? "This recipient revoked SMS consent."
          : "This recipient has not opted in to SMS.",
      retryable: false,
    };
  }

  try {
    contactId ??= await ensureCanonicalContactForPhone({
      runtime,
      phoneE164,
      occurredAtIso: attemptedAtIso,
    });
  } catch {
    return {
      ok: false,
      code: "validation_error",
      message: "That phone number could not be matched safely.",
      retryable: false,
    };
  }
  const contact = await runtime.repositories.contacts.findById(contactId);

  const messageId = randomUUID();
  await runtime.repositories.smsMessages.insert({
    id: messageId,
    twilioMessageSid: null,
    direction: "outbound",
    contactId,
    phoneE164,
    senderId: sender.id,
    broadcastRunId: null,
    body,
    segments: metrics.segments,
    encoding: metrics.encoding,
    mediaUrls: null,
    sendStatus: "queued",
    failedReason: null,
    failedDetail: null,
    sentAt: null,
    receivedAt: null,
    actorId: currentUser.id,
    createdAt: attemptedAt,
    updatedAt: attemptedAt,
  });

  try {
    const sendResult = await sendSmsViaTwilio({
      toE164: phoneE164,
      body,
    });

    await runtime.repositories.smsMessages.updateDelivery({
      messageId,
      twilioMessageSid: sendResult.messageSid,
      status: "sent",
      sentAt: attemptedAt,
    });

    if (saveAsKnowledge && knowledgeProjectId !== null) {
      try {
        const contactDisplayName = (contact?.displayName ?? "").trim();
        const contactLabel =
          contactDisplayName.length > 0 ? contactDisplayName : phoneE164;
        const trimmedBody = body.trim();
        const fallbackSummary =
          trimmedBody.length <= 60
            ? trimmedBody
            : `${trimmedBody.slice(0, 57).trimEnd()}...`;

        await captureKnowledgeFromSend({
          runtime,
          projectId: knowledgeProjectId,
          bodyPlaintext: body,
          createdAt: attemptedAt,
          createdByUserId: currentUser.id,
          source: {
            channel: "sms",
            smsMessageId: messageId,
            twilioMessageSid: sendResult.messageSid,
            summary:
              contactLabel.length > 0 ? `SMS to ${contactLabel}` : fallbackSummary,
          },
        });
      } catch (error) {
        console.warn("SMS send succeeded but knowledge capture failed.", {
          messageId,
          projectId: knowledgeProjectId,
          error,
        });
      }
    }

    revalidateInboxContact(contactId);

    return {
      ok: true,
      data: {
        messageId,
        clientGeneratedId: parsedInput.data.clientGeneratedId,
      },
    };
  } catch (error) {
    const detail =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Twilio send failed.";

    await runtime.repositories.smsMessages.updateDelivery({
      messageId,
      status: "failed",
      failedReason: "twilio_send_failed",
      failedDetail: detail,
    });
    revalidateInboxContact(contactId);

    return {
      ok: false,
      code: "twilio_error",
      message: "SMS sending failed.",
      retryable: true,
    };
  }
}

async function updateNeedsFollowUp(
  formData: FormData,
  needsFollowUp: boolean,
): Promise<FollowUpActionResult> {
  const requestId = randomUUID();
  const contactId = readContactId(formData);

  let currentUser;
  try {
    currentUser = await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return unauthorizedError(requestId);
    }
    throw error;
  }

  if (contactId === null) {
    return {
      ok: false,
      code: "validation_error",
      message: "Missing contactId",
      requestId,
      fieldErrors: { contactId: "required" },
    };
  }

  const decision = await enforceRateLimit({
    scope: "server-action:inbox-follow-up",
    identifier: currentUser.id,
    limit: 30,
    audit: {
      actorType: "user",
      actorId: currentUser.id,
      action: "inbox.follow_up.rate_limited",
      entityType: "server_action",
      entityId: "inbox.follow_up",
      metadataJson: {
        contactId,
        needsFollowUp,
      },
    },
  });

  if (!decision.allowed) {
    /**
     * Server Actions do not expose per-request status/header controls the
     * same way Route Handlers do, so we surface the denial via the standard
     * FP-07 error envelope while still recording the audit event.
     */
    return followUpRateLimitError(requestId);
  }

  const result = await setInboxNeedsFollowUp({
    contactId,
    needsFollowUp,
  });

  if (!result.ok) {
    return {
      ok: false,
      code: "inbox_contact_not_found",
      message: "No inbox row for that contact",
      requestId,
      retryable: false,
    };
  }

  revalidateInboxContact(contactId);

  return {
    ok: true,
    data: { contactId, needsFollowUp },
    requestId,
  };
}

export async function draftWithAiAction(
  rawInput: AiDraftRequestPayload,
): Promise<DraftWithAiActionResult> {
  const requestId = randomUUID();
  const parsedInput = aiDraftRequestSchema.safeParse(rawInput);

  if (!parsedInput.success) {
    return aiDraftValidationError(requestId, {
      message: "AI draft input is invalid.",
      fieldErrors: Object.fromEntries(
        parsedInput.error.issues.map((issue) => [issue.path.join("."), issue.message]),
      ),
    });
  }

  let currentUser;
  try {
    currentUser = await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return unauthorizedError(requestId);
    }

    throw error;
  }

  if (!beginAiDraftRequest(currentUser.id)) {
    return {
      ok: false,
      code: "rate_limit_exceeded",
      message: "Too many AI draft requests are already running. Please wait a moment and try again.",
      requestId,
      retryable: true,
    };
  }

  try {
    const runtime = await getStage1WebRuntime();
    const provider = getAiProviderConfig();
    const response = await generateAiDraft(
      {
        repositories: runtime.repositories,
        invokeModel: provider.invokeModel,
        estimateCostUsd: provider.estimateCostUsd,
        model: provider.model,
        temperature: provider.temperature,
        maxTokens:
          parsedInput.data.channel === "sms"
            ? SMS_AI_MAX_TOKENS
            : provider.maxTokens,
        dailyCapUsd: provider.dailyCapUsd,
      },
      parsedInput.data,
    );

    return {
      ok: true,
      data: response,
      requestId,
    };
  } catch (error) {
    const classification = classifyAiDraftFailure(error);

    if (classification.kind === "misconfigured") {
      console.warn(
        "AI draft generation is not fully configured.",
        buildAiDraftFailureLogFields(error, requestId),
      );

      return {
        ok: false,
        code: "ai_draft_misconfigured",
        message:
          "AI drafting isn't fully set up for this workspace yet. Please contact an admin.",
        requestId,
        retryable: false,
      };
    }

    console.error("AI draft generation failed unexpectedly.", error);
    return {
      ok: false,
      code: "ai_draft_failed",
      message: "We could not generate an AI draft right now. Please try again.",
      requestId,
      retryable: true,
    };
  } finally {
    endAiDraftRequest(currentUser.id);
  }
}

export async function createNoteAction(rawInput: {
  readonly contactId: string;
  readonly body: string;
}): Promise<NoteCreateActionResult> {
  const requestId = randomUUID();
  const contactId = rawInput.contactId.trim();
  const body = normalizeInternalNoteBody(rawInput.body);

  if (contactId.length === 0) {
    return noteValidationError(requestId, {
      message: "A contact is required to save a note.",
      fieldErrors: {
        contactId: "Contact is required.",
      },
    });
  }

  const bodyValidationError = getInternalNoteValidationError(body);

  if (bodyValidationError !== null) {
    return noteValidationError(requestId, {
      message: bodyValidationError,
      fieldErrors: {
        body: bodyValidationError,
      },
    });
  }

  let currentUser;
  try {
    currentUser = await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return unauthorizedError(requestId);
    }
    throw error;
  }

  const decision = await enforceRateLimit({
    scope: "server-action:inbox-note-create",
    identifier: currentUser.id,
    limit: 60,
    audit: {
      actorType: "user",
      actorId: currentUser.id,
      action: "inbox.note_create.rate_limited",
      entityType: "server_action",
      entityId: "inbox.note_create",
      metadataJson: {
        contactId,
      },
    },
  });

  if (!decision.allowed) {
    return noteCreateRateLimitError(requestId);
  }

  const runtime = await getStage1WebRuntime();
  const noteId = randomUUID();

  await runtime.internalNotes.createNote({
    noteId,
    contactId,
    body,
    occurredAt: new Date().toISOString(),
    authorDisplayName: resolveCurrentUserDisplayName({
      name: currentUser.name,
      email: currentUser.email,
    }),
    authorId: currentUser.id,
  });

  await appendSecurityAudit({
    actorType: "user",
    actorId: currentUser.id,
    action: "inbox.note_created",
    entityType: "internal_note",
    entityId: noteId,
    result: "recorded",
    policyCode: "inbox.note",
    metadataJson: {
      contactId,
      noteId,
    },
  });

  revalidateInboxContact(contactId);

  return {
    ok: true,
    data: {
      noteId,
      contactId,
    },
    requestId,
  };
}

export async function updateNoteAction(rawInput: {
  readonly noteId: string;
  readonly body: string;
}): Promise<NoteUpdateActionResult> {
  const requestId = randomUUID();
  const noteId = rawInput.noteId.trim();
  const body = normalizeInternalNoteBody(rawInput.body);

  if (noteId.length === 0) {
    return noteValidationError(requestId, {
      message: "A note id is required.",
      fieldErrors: {
        noteId: "Note id is required.",
      },
    });
  }

  const bodyValidationError = getInternalNoteValidationError(body);

  if (bodyValidationError !== null) {
    return noteValidationError(requestId, {
      message: bodyValidationError,
      fieldErrors: {
        body: bodyValidationError,
      },
    });
  }

  let currentUser;
  try {
    currentUser = await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return unauthorizedError(requestId);
    }
    throw error;
  }

  const decision = await enforceRateLimit({
    scope: "server-action:inbox-note-update",
    identifier: currentUser.id,
    limit: 60,
    audit: {
      actorType: "user",
      actorId: currentUser.id,
      action: "inbox.note_update.rate_limited",
      entityType: "server_action",
      entityId: "inbox.note_update",
      metadataJson: {
        noteId,
      },
    },
  });

  if (!decision.allowed) {
    return noteUpdateRateLimitError(requestId);
  }

  const runtime = await getStage1WebRuntime();
  const contactId = await resolveInternalNoteContactId({
    runtime,
    noteId,
  });
  const result = await runtime.internalNotes.updateNote({
    noteId,
    body,
    authorId: currentUser.id,
  });

  if (result.outcome === "not_authorized") {
    return noteForbiddenError(requestId);
  }

  if (result.outcome === "not_found") {
    return noteNotFoundError(requestId);
  }

  await appendSecurityAudit({
    actorType: "user",
    actorId: currentUser.id,
    action: "inbox.note_updated",
    entityType: "internal_note",
    entityId: noteId,
    result: "recorded",
    policyCode: "inbox.note",
    metadataJson: {
      contactId,
      noteId,
    },
  });

  if (contactId !== null) {
    revalidateInboxContact(contactId);
  }

  return {
    ok: true,
    data: {
      noteId,
    },
    requestId,
  };
}

export async function deleteNoteAction(rawInput: {
  readonly noteId: string;
}): Promise<NoteDeleteActionResult> {
  const requestId = randomUUID();
  const noteId = rawInput.noteId.trim();

  if (noteId.length === 0) {
    return noteValidationError(requestId, {
      message: "A note id is required.",
      fieldErrors: {
        noteId: "Note id is required.",
      },
    });
  }

  let currentUser;
  try {
    currentUser = await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return unauthorizedError(requestId);
    }
    throw error;
  }

  const decision = await enforceRateLimit({
    scope: "server-action:inbox-note-delete",
    identifier: currentUser.id,
    limit: 60,
    audit: {
      actorType: "user",
      actorId: currentUser.id,
      action: "inbox.note_delete.rate_limited",
      entityType: "server_action",
      entityId: "inbox.note_delete",
      metadataJson: {
        noteId,
      },
    },
  });

  if (!decision.allowed) {
    return noteDeleteRateLimitError(requestId);
  }

  const runtime = await getStage1WebRuntime();
  const contactId = await resolveInternalNoteContactId({
    runtime,
    noteId,
  });
  const result = await runtime.internalNotes.deleteNote({
    noteId,
    authorId: currentUser.id,
    actorIsAdmin: currentUser.role === "admin",
  });

  if (result.outcome === "not_authorized") {
    return noteForbiddenError(requestId);
  }

  if (result.outcome === "not_found") {
    return noteNotFoundError(requestId);
  }

  await appendSecurityAudit({
    actorType: "user",
    actorId: currentUser.id,
    action: "inbox.note_deleted",
    entityType: "internal_note",
    entityId: noteId,
    result: "recorded",
    policyCode: "inbox.note",
    metadataJson: {
      contactId,
      noteId,
    },
  });

  if (contactId !== null) {
    revalidateInboxContact(contactId);
  }

  return {
    ok: true,
    data: {
      noteId,
    },
    requestId,
  };
}

export async function sendComposerAction(
  rawInput: ComposerSendActionInput,
): Promise<ComposerSendActionResult> {
  const requestId = randomUUID();
  const parsedInput = composerSendActionInputSchema.safeParse(rawInput);

  if (!parsedInput.success) {
    return composerValidationError(requestId, {
      message: "Composer send input is invalid.",
      fieldErrors: Object.fromEntries(
        parsedInput.error.issues.map((issue) => [
          issue.path.join("."),
          issue.message,
        ]),
      ),
    });
  }
  const saveAsKnowledge = readSaveAsKnowledgeFlag(parsedInput.data);

  let currentUser;
  try {
    currentUser = await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return unauthorizedError(requestId);
    }
    throw error;
  }

  const decision = await enforceRateLimit({
    scope: "server-action:composer-send",
    identifier: currentUser.id,
    limit: 30,
    audit: {
      actorType: "user",
      actorId: currentUser.id,
      action: "composer.send.rate_limited",
      entityType: "server_action",
      entityId: "composer.send",
      metadataJson: {
        alias: parsedInput.data.alias,
        recipientKind: parsedInput.data.recipient.kind,
      },
    },
  });

  if (!decision.allowed) {
    return composerRateLimitError(requestId);
  }

  const runtime = await getStage1WebRuntime();
  const alias = await runtime.settings.aliases.findByAlias(
    parsedInput.data.alias.trim().toLowerCase(),
  );

  if (alias === null) {
    return {
      ok: false,
      code: "alias_not_authorized",
      message: "That alias is not configured for composer sends.",
      requestId,
      retryable: false,
    };
  }

  const attemptedAt = new Date();
  const attemptedAtIso = attemptedAt.toISOString();
  let canonicalContactId: string;
  let toEmailNormalized: string | null;

  if (parsedInput.data.recipient.kind === "contact") {
    const contact = await runtime.repositories.contacts.findById(
      parsedInput.data.recipient.contactId,
    );

    if (contact === null) {
      return mapComposerProviderError(requestId, "invalid_recipient");
    }

    canonicalContactId = contact.id;
    toEmailNormalized = await resolveContactEmail({
      runtime,
      contactId: contact.id,
    });
  } else {
    toEmailNormalized = normalizeEmailAddress(
      parsedInput.data.recipient.emailAddress,
    );

    if (toEmailNormalized === null) {
      return mapComposerProviderError(requestId, "invalid_recipient");
    }

    let contact;
    try {
      contact = await runtime.normalization.ensureCanonicalContactForEmail({
        emailAddress: toEmailNormalized,
        createdAt: attemptedAtIso,
        source: "manual",
      });
    } catch (error) {
      if (error instanceof CanonicalContactAmbiguityError) {
        // TODO: Surface ambiguous-recipient routing review UX instead of refusing.
        return mapComposerProviderError(requestId, "invalid_recipient");
      }

      throw error;
    }
    canonicalContactId = contact.id;
  }

  if (toEmailNormalized === null) {
    return mapComposerProviderError(requestId, "invalid_recipient");
  }

  const signature = readAliasSignature(
    alias as unknown as Record<string, unknown>,
  );
  const cc = normalizeEmailAddresses(parsedInput.data.cc);
  const bcc = normalizeEmailAddresses(parsedInput.data.bcc);
  const bodyPlaintext = appendSignature(
    parsedInput.data.bodyPlaintext,
    signature,
  );
  const bodyHtml = appendComposerHtmlSignature({
    bodyHtml: parsedInput.data.bodyHtml,
    bodyPlaintext: parsedInput.data.bodyPlaintext,
    signaturePlaintext: signature,
  });
  const fingerprint = computePendingComposerOutboundFingerprint({
    contactId: canonicalContactId,
    subject: parsedInput.data.subject,
    bodyPlaintext,
    sentAt: attemptedAtIso,
  });

  if (fingerprint === null) {
    return composerValidationError(requestId, {
      message: "Subject and body are required to send composer email.",
      fieldErrors: {
        subject: "required",
        bodyPlaintext: "required",
      },
    });
  }

  const pendingOutboundId = await runtime.repositories.pendingOutbounds.insert({
    id: randomUUID(),
    fingerprint,
    actorId: currentUser.id,
    canonicalContactId,
    projectId: alias.projectId,
    fromAlias: alias.alias,
    toEmailNormalized,
    subject: parsedInput.data.subject,
    bodyPlaintext,
    bodyHtml,
    bodySha256: sha256Text(bodyPlaintext),
    attachmentMetadata: buildAttachmentMetadata(parsedInput.data.attachments),
    gmailThreadId: parsedInput.data.threadId ?? null,
    inReplyToRfc822: parsedInput.data.inReplyToRfc822 ?? null,
    attemptedAt: attemptedAtIso,
  });

  await appendSecurityAudit({
    actorType: "user",
    actorId: currentUser.id,
    action: "composer.send_attempted",
    entityType: "pending_composer_outbound",
    entityId: pendingOutboundId,
    result: "recorded",
    policyCode: "composer.send",
    metadataJson: {
      canonicalContactId,
      projectId: alias.projectId,
      fromAlias: alias.alias,
      toEmailNormalized,
      subject: parsedInput.data.subject,
      attachmentCount: parsedInput.data.attachments.length,
      ccCount: cc.length,
      bccCount: bcc.length,
      supersedesPendingId: parsedInput.data.supersedesPendingId ?? null,
    },
  });

  try {
    const sendParams = {
      fromAlias: alias.alias,
      to: toEmailNormalized,
      ...(cc.length > 0 ? { cc } : {}),
      ...(bcc.length > 0 ? { bcc } : {}),
      subject: parsedInput.data.subject,
      bodyPlaintext,
      bodyHtml,
      attachments: parsedInput.data.attachments,
      ...(parsedInput.data.threadId === undefined
        ? {}
        : { threadId: parsedInput.data.threadId }),
      ...(parsedInput.data.inReplyToRfc822 === undefined
        ? {}
        : {
            inReplyToRfc822MessageId: parsedInput.data.inReplyToRfc822,
            referencesRfc822MessageIds: [parsedInput.data.inReplyToRfc822],
          }),
    };
    const sendResult = await sendComposerGmailMessage(sendParams, {
      resolveThreadIdViaRfc822: true,
    });

    if (sendResult.kind === "success") {
      await runtime.repositories.pendingOutbounds.markConfirmed(pendingOutboundId, {
        reconciledEventId: null,
      });

      await appendSecurityAudit({
        actorType: "user",
        actorId: currentUser.id,
        action: "composer.send_succeeded",
        entityType: "pending_composer_outbound",
        entityId: pendingOutboundId,
        result: "recorded",
        policyCode: "composer.send",
        metadataJson: {
          canonicalContactId,
          gmailMessageId: sendResult.gmailMessageId,
          gmailThreadId: sendResult.gmailThreadId,
          rfc822MessageId: sendResult.rfc822MessageId,
          supersedesPendingId: parsedInput.data.supersedesPendingId ?? null,
        },
      });

      await runtime.repositories.pendingOutbounds.markSentRfc822(
        pendingOutboundId,
        sendResult.rfc822MessageId,
      );

      if (parsedInput.data.supersedesPendingId !== undefined) {
        await runtime.repositories.pendingOutbounds.markSuperseded(
          parsedInput.data.supersedesPendingId,
        );
      }

      if (saveAsKnowledge && alias.projectId !== null) {
        try {
          await captureKnowledgeFromSend({
            runtime,
            projectId: alias.projectId,
            bodyPlaintext,
            createdAt: attemptedAt,
            createdByUserId: currentUser.id,
            source: {
              channel: "email",
              subject: parsedInput.data.subject,
              pendingOutboundId,
              gmailMessageId: sendResult.gmailMessageId,
              gmailThreadId: sendResult.gmailThreadId,
              rfc822MessageId: sendResult.rfc822MessageId,
            },
          });
        } catch (error) {
          console.warn("Composer send succeeded but knowledge capture failed.", {
            pendingOutboundId,
            projectId: alias.projectId,
            error,
          });
        }
      }

      revalidateInboxContact(canonicalContactId);

      return {
        ok: true,
        data: {
          pendingOutboundId,
          canonicalContactId,
          threadId: sendResult.gmailThreadId,
          clientGeneratedId: parsedInput.data.clientGeneratedId ?? null,
        },
        requestId,
      };
    }

    const failedDetail = describeComposerSendError(sendResult);
    await runtime.repositories.pendingOutbounds.markFailed(pendingOutboundId, {
      reason: sendResult.kind,
      detail: failedDetail,
    });
    await appendSecurityAudit({
      actorType: "user",
      actorId: currentUser.id,
      action: "composer.send_failed",
      entityType: "pending_composer_outbound",
      entityId: pendingOutboundId,
      result: "recorded",
      policyCode: "composer.send",
      metadataJson: {
        canonicalContactId,
        reason: sendResult.kind,
        detail: failedDetail,
      },
    });
    revalidateInboxContact(canonicalContactId);

    return mapComposerProviderError(requestId, sendResult.kind);
  } catch (error) {
    const exceptionDetail =
      error instanceof Error ? error.message : String(error);
    await runtime.repositories.pendingOutbounds.markFailed(pendingOutboundId, {
      reason: "exception",
      detail: exceptionDetail,
    });
    await appendSecurityAudit({
      actorType: "user",
      actorId: currentUser.id,
      action: "composer.send_failed",
      entityType: "pending_composer_outbound",
      entityId: pendingOutboundId,
      result: "recorded",
      policyCode: "composer.send",
      metadataJson: {
        canonicalContactId,
        reason: "exception",
        detail: exceptionDetail,
      },
    });
    revalidateInboxContact(canonicalContactId);

    return composerGenericRetryableError(requestId);
  }
}

export async function markInboxNeedsFollowUpAction(
  formData: FormData,
): Promise<FollowUpActionResult> {
  return updateNeedsFollowUp(formData, true);
}

export async function clearInboxNeedsFollowUpAction(
  formData: FormData,
): Promise<FollowUpActionResult> {
  return updateNeedsFollowUp(formData, false);
}

async function setContactArchivedFlag(
  formData: FormData,
  archived: boolean,
): Promise<InboxArchiveActionResult> {
  const requestId = randomUUID();
  const contactId = readContactId(formData);

  let currentUser;
  try {
    currentUser = await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return unauthorizedError(requestId);
    }
    throw error;
  }

  if (contactId === null) {
    return {
      ok: false,
      code: "validation_error",
      message: "Missing contactId",
      requestId,
      fieldErrors: { contactId: "required" },
    };
  }

  const decision = await enforceRateLimit({
    scope: "server-action:inbox-archive",
    identifier: currentUser.id,
    limit: 60,
    audit: {
      actorType: "user",
      actorId: currentUser.id,
      action: "inbox.archive.rate_limited",
      entityType: "server_action",
      entityId: "inbox.archive",
      metadataJson: {
        contactId,
        archived,
      },
    },
  });

  if (!decision.allowed) {
    return archiveRateLimitError(requestId);
  }

  const result = await setInboxArchived({ contactId, archived });

  if (!result.ok) {
    return {
      ok: false,
      code: "inbox_contact_not_found",
      message: "No inbox row for that contact",
      requestId,
      retryable: false,
    };
  }

  revalidateInboxContact(contactId);

  return {
    ok: true,
    data: { contactId },
    requestId,
  };
}

export async function archiveInboxContactAction(
  formData: FormData,
): Promise<InboxArchiveActionResult> {
  return setContactArchivedFlag(formData, true);
}

export async function unarchiveInboxContactAction(
  formData: FormData,
): Promise<InboxArchiveActionResult> {
  return setContactArchivedFlag(formData, false);
}

async function updateInboxBucket(
  formData: FormData,
  bucket: "New" | "Opened",
): Promise<InboxBucketActionResult> {
  const requestId = randomUUID();
  const contactId = readContactId(formData);

  let currentUser;
  try {
    currentUser = await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return unauthorizedError(requestId);
    }
    throw error;
  }

  if (contactId === null) {
    return {
      ok: false,
      code: "validation_error",
      message: "Missing contactId",
      requestId,
      fieldErrors: { contactId: "required" },
    };
  }

  const decision = await enforceRateLimit({
    scope: "server-action:inbox-bucket",
    identifier: currentUser.id,
    limit: 60,
    audit: {
      actorType: "user",
      actorId: currentUser.id,
      action: "inbox.bucket.rate_limited",
      entityType: "server_action",
      entityId: "inbox.bucket",
      metadataJson: {
        contactId,
        bucket,
      },
    },
  });

  if (!decision.allowed) {
    return bucketRateLimitError(requestId);
  }

  const result = await setInboxBucket({ contactId, bucket });

  if (!result.ok) {
    return {
      ok: false,
      code: "inbox_contact_not_found",
      message: "No inbox row for that contact",
      requestId,
      retryable: false,
    };
  }

  if (bucket === "Opened") {
    await appendSecurityAudit({
      actorType: "user",
      actorId: currentUser.id,
      action: "inbox.attention.read",
      entityType: "contact",
      entityId: contactId,
      result: "recorded",
      policyCode: "inbox.shared_read_state",
      metadataJson: {},
    });
  }

  revalidateInboxContact(contactId);

  return {
    ok: true,
    data: { contactId, bucket },
    requestId,
  };
}

export async function markInboxOpenedAction(
  formData: FormData,
): Promise<InboxBucketActionResult> {
  return updateInboxBucket(formData, "Opened");
}

export async function markInboxUnreadAction(
  formData: FormData,
): Promise<InboxBucketActionResult> {
  return updateInboxBucket(formData, "New");
}
