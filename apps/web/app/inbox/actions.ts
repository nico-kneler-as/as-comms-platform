"use server";

import { setInboxNeedsFollowUp } from "../../src/server/inbox/follow-up";
import { revalidateInboxContact } from "../../src/server/inbox/revalidate";
import type { UiResult } from "../../src/server/ui-result";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type FollowUpActionData = {
  readonly contactId: string;
  readonly needsFollowUp: boolean;
};

export type FollowUpActionResult = UiResult<FollowUpActionData>;

function readContactId(formData: FormData): string | null {
  const value = formData.get("contactId");
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

async function updateNeedsFollowUp(
  formData: FormData,
  needsFollowUp: boolean
): Promise<FollowUpActionResult> {
  const requestId = crypto.randomUUID();
  const contactId = readContactId(formData);

  if (contactId === null) {
    return {
      ok: false,
      code: "validation_error",
      message: "Missing contactId",
      requestId,
      fieldErrors: { contactId: "required" }
    };
  }

  const result = await setInboxNeedsFollowUp({
    contactId,
    needsFollowUp
  });

  if (!result.ok) {
    return {
      ok: false,
      code: "inbox_contact_not_found",
      message: "No inbox row for that contact",
      requestId,
      retryable: false
    };
  }

  revalidateInboxContact(contactId);

  return {
    ok: true,
    data: { contactId, needsFollowUp },
    requestId
  };
}

export async function markInboxNeedsFollowUpAction(
  formData: FormData
): Promise<FollowUpActionResult> {
  return updateNeedsFollowUp(formData, true);
}

export async function clearInboxNeedsFollowUpAction(
  formData: FormData
): Promise<FollowUpActionResult> {
  return updateNeedsFollowUp(formData, false);
}
