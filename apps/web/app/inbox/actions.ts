"use server";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { composerSendInputSchema } from "@as-comms/contracts";
import { computePendingComposerOutboundFingerprint } from "@as-comms/domain";
import { requireSession } from "@/src/server/auth/session";
import { sendComposerGmailMessage } from "@/src/server/composer/gmail-send";
import {
  aiDraftRequestSchema,
  generateAiDraft,
  type AiDraftRequestPayload,
  type AiDraftResponse,
} from "@/src/server/ai";
import { getAiProviderConfig } from "@/src/server/ai/provider";
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

import type { UiResult } from "../../src/server/ui-result";

const composerSendActionInputSchema = composerSendInputSchema.extend({
  captureAsKnowledge: z.boolean().optional().default(false),
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
export type ComposerSendActionData = {
  readonly pendingOutboundId: string;
  readonly canonicalContactId: string;
  readonly threadId: string | null;
};

export type ComposerSendActionInput = z.input<
  typeof composerSendActionInputSchema
>;
export type ComposerSendActionResult = UiResult<ComposerSendActionData>;

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
  readonly salesforceContactId: string | null;
  readonly primaryProjectName: string | null;
};

export type ContactSearchActionResult = UiResult<
  readonly ContactSearchResult[]
>;
export type AiDraftResponseVm = AiDraftResponse;
export type DraftWithAiActionResult = UiResult<AiDraftResponseVm>;

interface AiDraftConcurrencyState {
  readonly counts: Map<string, number>;
}

declare global {
  var __AS_COMMS_AI_DRAFT_CONCURRENCY__: AiDraftConcurrencyState | undefined;
}

function getAiDraftConcurrencyState(): AiDraftConcurrencyState {
  globalThis.__AS_COMMS_AI_DRAFT_CONCURRENCY__ ??= {
    counts: new Map<string, number>(),
  };

  return globalThis.__AS_COMMS_AI_DRAFT_CONCURRENCY__;
}

function maskKnowledgeExample(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "{EMAIL}")
    .replace(/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/gu, "{PHONE}")
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/gu, "{NAME}");
}

function firstNonEmptyText(values: readonly (string | null | undefined)[]): string {
  for (const value of values) {
    const trimmed = value?.trim() ?? "";
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return "Captured reply";
}

function truncateKnowledgeSummary(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= 50) {
    return normalized;
  }

  return normalized.slice(0, 50).trimEnd();
}

async function resolveLastInboundSummary(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly contactId: string;
}): Promise<string> {
  const events = await input.runtime.repositories.canonicalEvents.listByContactId(
    input.contactId,
  );
  const inbound = events
    .filter((event) => event.eventType.endsWith(".inbound"))
    .at(-1);

  if (inbound === undefined) {
    return "Captured reply";
  }

  const [gmailDetails, salesforceDetails, simpleTextingDetails] =
    await Promise.all([
      input.runtime.repositories.gmailMessageDetails.listBySourceEvidenceIds([
        inbound.sourceEvidenceId,
      ]),
      input.runtime.repositories.salesforceCommunicationDetails.listBySourceEvidenceIds(
        [inbound.sourceEvidenceId],
      ),
      input.runtime.repositories.simpleTextingMessageDetails.listBySourceEvidenceIds(
        [inbound.sourceEvidenceId],
      ),
    ]);

  const gmailDetail = gmailDetails[0];
  const salesforceDetail = salesforceDetails[0];
  const simpleTextingDetail = simpleTextingDetails[0];

  return truncateKnowledgeSummary(
    firstNonEmptyText([
      gmailDetail?.subject,
      salesforceDetail?.subject,
      gmailDetail?.bodyTextPreview,
      gmailDetail?.snippetClean,
      simpleTextingDetail?.messageTextPreview,
      salesforceDetail?.snippet,
    ]),
  );
}

async function captureKnowledgeFromSend(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly projectId: string;
  readonly contactId: string;
  readonly bodyPlaintext: string;
  readonly pendingOutboundId: string;
  readonly gmailMessageId: string;
  readonly gmailThreadId: string | null;
  readonly rfc822MessageId: string | null;
  readonly createdAt: Date;
}): Promise<void> {
  const questionSummary = await resolveLastInboundSummary({
    runtime: input.runtime,
    contactId: input.contactId,
  });
  const nowIso = input.createdAt.toISOString();

  await input.runtime.repositories.projectKnowledge.upsert({
    id: `project_knowledge:captured:${input.pendingOutboundId}`,
    projectId: input.projectId,
    kind: "canonical_reply",
    issueType: null,
    volunteerStage: null,
    questionSummary,
    replyStrategy: null,
    maskedExample: maskKnowledgeExample(input.bodyPlaintext),
    sourceKind: "captured_from_send",
    approvedForAi: false,
    sourceEventId: null,
    metadataJson: {
      pendingOutboundId: input.pendingOutboundId,
      gmailMessageId: input.gmailMessageId,
      gmailThreadId: input.gmailThreadId,
      rfc822MessageId: input.rfc822MessageId,
    },
    lastReviewedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
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

function buildManualNoteCanonicalEventId(noteId: string): string {
  return `canonical-event:manual:note:${noteId}`;
}

async function resolveManualNoteContactId(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly noteId: string;
}): Promise<string | null> {
  const canonicalEvent =
    await input.runtime.repositories.canonicalEvents.findById(
      buildManualNoteCanonicalEventId(input.noteId),
    );

  return canonicalEvent?.contactId ?? null;
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
        maxTokens: provider.maxTokens,
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
  const contactId = await resolveManualNoteContactId({
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
  const contactId = await resolveManualNoteContactId({
    runtime,
    noteId,
  });
  const result = await runtime.internalNotes.deleteNote({
    noteId,
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

  const sentAt = new Date();
  const sentAtIso = sentAt.toISOString();
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

    const contact = await runtime.normalization.ensureCanonicalContactForEmail({
      emailAddress: toEmailNormalized,
      createdAt: sentAtIso,
      source: "manual",
    });
    canonicalContactId = contact.id;
  }

  if (toEmailNormalized === null) {
    return mapComposerProviderError(requestId, "invalid_recipient");
  }

  const signature = readAliasSignature(
    alias as unknown as Record<string, unknown>,
  );
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
    sentAt: sentAtIso,
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
    sentAt: sentAtIso,
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
      supersedesPendingId: parsedInput.data.supersedesPendingId ?? null,
    },
  });

  try {
    const sendParams = {
      fromAlias: alias.alias,
      to: toEmailNormalized,
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
    const sendResult = await sendComposerGmailMessage(sendParams);

    if (sendResult.kind === "success") {
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

      if (parsedInput.data.supersedesPendingId !== undefined) {
        await runtime.repositories.pendingOutbounds.markSuperseded(
          parsedInput.data.supersedesPendingId,
        );
      }

      if (parsedInput.data.captureAsKnowledge && alias.projectId !== null) {
        try {
          await captureKnowledgeFromSend({
            runtime,
            projectId: alias.projectId,
            contactId: canonicalContactId,
            bodyPlaintext,
            pendingOutboundId,
            gmailMessageId: sendResult.gmailMessageId,
            gmailThreadId: sendResult.gmailThreadId,
            rfc822MessageId: sendResult.rfc822MessageId,
            createdAt: sentAt,
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
        },
        requestId,
      };
    }

    await runtime.repositories.pendingOutbounds.markFailed(pendingOutboundId, {
      reason: sendResult.kind,
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
      },
    });
    revalidateInboxContact(canonicalContactId);

    return mapComposerProviderError(requestId, sendResult.kind);
  } catch {
    await runtime.repositories.pendingOutbounds.markFailed(pendingOutboundId, {
      reason: "exception",
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
