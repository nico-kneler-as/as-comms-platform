"use server";

import { requireSession } from "@/src/server/auth/session";
import { enforceRateLimit } from "@/src/server/security/rate-limit";

import { setInboxNeedsFollowUp } from "../../src/server/inbox/follow-up";
import { revalidateInboxContact } from "../../src/server/inbox/revalidate";
import type { UiResult } from "../../src/server/ui-result";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type FollowUpActionData = {
  readonly contactId: string;
  readonly needsFollowUp: boolean;
};

export type FollowUpActionResult = UiResult<FollowUpActionData>;

function unauthorizedError(requestId: string): FollowUpActionResult {
  return {
    ok: false,
    code: "unauthorized",
    message: "Your session has expired. Please sign in again.",
    requestId,
  };
}

function rateLimitError(requestId: string): FollowUpActionResult {
  return {
    ok: false,
    code: "rate_limit_exceeded",
    message: "Too many follow-up updates. Please wait a minute and try again.",
    requestId,
    retryable: true,
  };
}

function readContactId(formData: FormData): string | null {
  const value = formData.get("contactId");
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

async function updateNeedsFollowUp(
  formData: FormData,
  needsFollowUp: boolean,
): Promise<FollowUpActionResult> {
  const requestId = crypto.randomUUID();
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
    return rateLimitError(requestId);
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
