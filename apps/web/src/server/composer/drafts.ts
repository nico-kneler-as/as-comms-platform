"use server";

import { randomUUID } from "node:crypto";

import {
  composerDraftAttachmentSchema,
  composerDraftChannelSchema,
  composerDraftForwardContextSchema,
  composerDraftIdSchema,
  composerDraftPaneModeSchema,
  composerDraftRecipientKindSchema,
  composerDraftsListInputSchema,
  type ComposerDraftAttachment,
  type ComposerDraftForwardContext,
  type ComposerDraftsListInputValue,
} from "@as-comms/contracts";
import {
  deleteComposerDraft,
  listComposerDraftsByActor,
  upsertComposerDraft,
  type ComposerDraftRecord,
} from "@as-comms/db";
import { requireSession } from "@/src/server/auth/session";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";
import type { UiResult } from "@/src/server/ui-result";
import { z } from "zod";

const upsertComposerDraftActionInputSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  pane_mode: composerDraftPaneModeSchema,
  channel: composerDraftChannelSchema,
  recipient_anchor_kind: composerDraftRecipientKindSchema.nullable(),
  recipient_contact_id: z.string().nullable(),
  recipient_email: z.string().trim().email().nullable(),
  recipient_phone: z.string().nullable(),
  subject: z.string(),
  body_plaintext: z.string(),
  body_html: z.string(),
  selected_alias: z.string().trim().email().nullable(),
  cc: z.array(z.string().trim().email()).default([]),
  bcc: z.array(z.string().trim().email()).default([]),
  attachments: z.array(composerDraftAttachmentSchema).default([]),
  ai_directive: z.string().default(""),
  reply_context_thread_cursor: z.string().nullable(),
  forward_context: composerDraftForwardContextSchema.nullable(),
}).superRefine((value, context) => {
  const hasContactId =
    value.recipient_contact_id !== null && value.recipient_contact_id.length > 0;
  const hasEmail =
    value.recipient_email !== null && value.recipient_email.length > 0;
  const hasPhone =
    value.recipient_phone !== null && value.recipient_phone.length > 0;

  if (value.recipient_anchor_kind === "contact" && !hasContactId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recipient_contact_id"],
      message: "recipient_contact_id is required when recipient_anchor_kind=contact",
    });
  }

  if (value.recipient_anchor_kind === "email" && !hasEmail) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recipient_email"],
      message: "recipient_email is required when recipient_anchor_kind=email",
    });
  }

  if (value.recipient_anchor_kind === "phone" && !hasPhone) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recipient_phone"],
      message: "recipient_phone is required when recipient_anchor_kind=phone",
    });
  }

  if (
    value.pane_mode === "replying" &&
    value.reply_context_thread_cursor === null
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reply_context_thread_cursor"],
      message: "reply_context_thread_cursor is required when pane_mode=replying",
    });
  }

  if (value.pane_mode === "forwarding" && value.forward_context === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["forward_context"],
      message: "forward_context is required when pane_mode=forwarding",
    });
  }
});

export interface UpsertComposerDraftActionInput {
  readonly id?: string | null;
  readonly pane_mode: "new_draft" | "replying" | "forwarding";
  readonly channel: "email" | "sms" | "note";
  readonly recipient_anchor_kind: "contact" | "email" | "phone" | null;
  readonly recipient_contact_id: string | null;
  readonly recipient_email: string | null;
  readonly recipient_phone: string | null;
  readonly subject: string;
  readonly body_plaintext: string;
  readonly body_html: string;
  readonly selected_alias: string | null;
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly attachments?: readonly ComposerDraftAttachment[];
  readonly ai_directive?: string;
  readonly reply_context_thread_cursor: string | null;
  readonly forward_context: ComposerDraftForwardContext | null;
}

export interface ComposerDraftDeleteActionInput {
  readonly id: string;
}

export type ListComposerDraftsActionResult = UiResult<{
  readonly drafts: readonly ComposerDraftRecord[];
  readonly nextCursor: string | null;
}>;

export type UpsertComposerDraftActionResult = UiResult<ComposerDraftRecord>;
export type DeleteComposerDraftActionResult = UiResult<{
  readonly deletedCount: number;
}>;

function unauthorizedError(requestId: string): UiResult<never> {
  return {
    ok: false,
    code: "unauthorized",
    message: "You must be signed in to continue.",
    requestId,
    retryable: false,
  };
}

function validationError(
  requestId: string,
  message: string,
  fieldErrors: Record<string, string>,
): UiResult<never> {
  return {
    ok: false,
    code: "validation_error",
    message,
    requestId,
    fieldErrors,
    retryable: false,
  };
}

function unexpectedError(
  requestId: string,
  message: string,
  error: unknown,
): UiResult<never> {
  const details =
    error && typeof error === "object"
      ? {
          code: "code" in error ? error.code : undefined,
          detail: "detail" in error ? error.detail : undefined,
          hint: "hint" in error ? error.hint : undefined,
          cause: "cause" in error ? error.cause : undefined,
        }
      : undefined;

  console.error("[composer/drafts] unexpected failure", {
    requestId,
    error,
    ...details,
  });

  return {
    ok: false,
    code: "composer_draft_failed",
    message,
    requestId,
    retryable: true,
  };
}

function requireDb(
  runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>,
  requestId: string,
) {
  if (runtime.connection === null) {
    throw new Error(`[${requestId}] DATABASE_UNAVAILABLE`);
  }

  return runtime.connection.db;
}

function toFieldErrors(issues: readonly { path: readonly (string | number)[]; message: string }[]) {
  return Object.fromEntries(
    issues.map((issue) => [issue.path.join("."), issue.message]),
  );
}

export async function upsertComposerDraftAction(
  rawInput: UpsertComposerDraftActionInput,
): Promise<UpsertComposerDraftActionResult> {
  const requestId = randomUUID();
  const parsedInput = upsertComposerDraftActionInputSchema.safeParse(rawInput);

  if (!parsedInput.success) {
    return validationError(
      requestId,
      "Composer draft input is invalid.",
      toFieldErrors(parsedInput.error.issues),
    );
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

  try {
    const runtime = await getStage1WebRuntime();
    const record = await upsertComposerDraft(requireDb(runtime, requestId), {
      id: rawInput.id ?? null,
      actorId: currentUser.id,
      paneMode:
        parsedInput.data.pane_mode === "new_draft"
          ? "new-draft"
          : parsedInput.data.pane_mode,
      channel: parsedInput.data.channel,
      recipientAnchorKind: parsedInput.data.recipient_anchor_kind,
      recipientContactId: parsedInput.data.recipient_contact_id,
      recipientEmail: parsedInput.data.recipient_email,
      recipientPhone: parsedInput.data.recipient_phone,
      subject: parsedInput.data.subject,
      bodyPlaintext: parsedInput.data.body_plaintext,
      bodyHtml: parsedInput.data.body_html,
      selectedAlias: parsedInput.data.selected_alias,
      cc: parsedInput.data.cc,
      bcc: parsedInput.data.bcc,
      attachments: parsedInput.data.attachments,
      aiDirective: parsedInput.data.ai_directive,
      replyContextThreadCursor: parsedInput.data.reply_context_thread_cursor,
      forwardContext: parsedInput.data.forward_context,
    });

    if (record === null) {
      return {
        ok: false,
        code: "composer_draft_not_found",
        message: "That draft no longer exists.",
        requestId,
        retryable: false,
      };
    }

    return {
      ok: true,
      data: record,
      requestId,
    };
  } catch (error) {
    return unexpectedError(
      requestId,
      "We could not save that draft right now.",
      error,
    );
  }
}

export async function listComposerDraftsAction(
  rawInput: ComposerDraftsListInputValue = {},
): Promise<ListComposerDraftsActionResult> {
  const requestId = randomUUID();
  const parsedInput = composerDraftsListInputSchema.safeParse(rawInput);

  if (!parsedInput.success) {
    return validationError(
      requestId,
      "Composer draft list input is invalid.",
      toFieldErrors(parsedInput.error.issues),
    );
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

  try {
    const runtime = await getStage1WebRuntime();
    const result = await listComposerDraftsByActor(requireDb(runtime, requestId), {
      actorId: currentUser.id,
      limit: parsedInput.data.limit,
      cursor: parsedInput.data.cursor ?? null,
    });

    return {
      ok: true,
      data: result,
      requestId,
    };
  } catch (error) {
    return unexpectedError(
      requestId,
      "We could not load saved drafts right now.",
      error,
    );
  }
}

export async function deleteComposerDraftAction(
  rawInput: ComposerDraftDeleteActionInput,
): Promise<DeleteComposerDraftActionResult> {
  const requestId = randomUUID();
  const parsedInput = composerDraftIdSchema.safeParse(rawInput.id);

  if (!parsedInput.success) {
    return validationError(requestId, "Draft id is invalid.", {
      id: parsedInput.error.issues[0]?.message ?? "Invalid draft id.",
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

  try {
    const runtime = await getStage1WebRuntime();
    const deletedCount = await deleteComposerDraft(requireDb(runtime, requestId), {
      id: parsedInput.data,
      actorId: currentUser.id,
    });

    return {
      ok: true,
      data: { deletedCount },
      requestId,
    };
  } catch (error) {
    return unexpectedError(
      requestId,
      "We could not delete that draft right now.",
      error,
    );
  }
}
