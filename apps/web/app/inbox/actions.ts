"use server";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { computePendingComposerOutboundFingerprint } from "@as-comms/domain";
import { requireSession } from "@/src/server/auth/session";
import { sendComposerGmailMessage } from "@/src/server/composer/gmail-send";
import { setInboxNeedsFollowUp } from "@/src/server/inbox/follow-up";
import { revalidateInboxContact } from "@/src/server/inbox/revalidate";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";
import { appendSecurityAudit } from "@/src/server/security/audit";
import { enforceRateLimit } from "@/src/server/security/rate-limit";

import type { UiResult } from "../../src/server/ui-result";

const composerRecipientSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("contact"),
    contactId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("email"),
    emailAddress: z.string().email(),
  }),
]);

const composerAttachmentSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  contentBase64: z.string().min(1),
});

const composerBodyPlaintextSchema = z.string().refine(
  (value) => value.trim().length > 0,
  {
    message: "Body is required.",
  }
);

const composerSendActionInputSchema = z.object({
  recipient: composerRecipientSchema,
  alias: z.string().email(),
  subject: z.string().trim().min(1),
  bodyPlaintext: composerBodyPlaintextSchema,
  attachments: z.array(composerAttachmentSchema),
  threadId: z.string().min(1).optional(),
  inReplyToRfc822: z.string().min(1).optional(),
  supersedesPendingId: z.string().min(1).optional(),
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
export type ComposerSendActionData = {
  readonly pendingOutboundId: string;
  readonly canonicalContactId: string;
  readonly threadId: string | null;
};

export type ComposerSendActionInput = z.input<
  typeof composerSendActionInputSchema
>;
export type ComposerSendActionResult = UiResult<ComposerSendActionData>;

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

function composerRateLimitError(requestId: string): ComposerSendActionResult {
  return {
    ok: false,
    code: "rate_limit_exceeded",
    message: "Too many composer sends. Please wait a minute and try again.",
    requestId,
    retryable: true,
  };
}

function composerValidationError(
  requestId: string,
  input: {
    readonly message: string;
    readonly fieldErrors?: Record<string, string>;
  }
): ComposerSendActionResult {
  return {
    ok: false,
    code: "validation_error",
    message: input.message,
    requestId,
    retryable: false,
    ...(input.fieldErrors === undefined ? {} : { fieldErrors: input.fieldErrors }),
  };
}

function composerGenericRetryableError(
  requestId: string
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
    | "permanent"
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
  return signature.length > 0 ? `${bodyPlaintext}\n\n${signature}` : bodyPlaintext;
}

function buildAttachmentMetadata(
  attachments: ComposerSendActionParsedInput["attachments"]
) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    size: Buffer.from(attachment.contentBase64, "base64").length,
    contentType: attachment.contentType,
  }));
}

async function resolveContactEmail(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly contactId: string;
}): Promise<string | null> {
  const contact = await input.runtime.repositories.contacts.findById(input.contactId);

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
    await input.runtime.repositories.contactIdentities.listByContactId(contact.id);

  return (
    identities.find((identity) => identity.kind === "email")?.normalizedValue ?? null
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

export async function sendComposerAction(
  rawInput: ComposerSendActionInput
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
        ])
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
    parsedInput.data.alias.trim().toLowerCase()
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
      parsedInput.data.recipient.contactId
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
      parsedInput.data.recipient.emailAddress
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

  const signature = readAliasSignature(alias as unknown as Record<string, unknown>);
  const bodyPlaintext = appendSignature(parsedInput.data.bodyPlaintext, signature);
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
          parsedInput.data.supersedesPendingId
        );
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
