"use server";

import { setInboxNeedsFollowUp } from "../../src/server/inbox/follow-up";
import { revalidateInboxContact } from "../../src/server/inbox/revalidate";

export type FollowUpActionResult =
  | {
      readonly ok: true;
      readonly contactId: string;
      readonly needsFollowUp: boolean;
    }
  | {
      readonly ok: false;
      readonly code: "validation_error" | "inbox_contact_not_found";
    };

function readContactId(formData: FormData): string | null {
  const value = formData.get("contactId");
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

async function updateNeedsFollowUp(
  formData: FormData,
  needsFollowUp: boolean
): Promise<FollowUpActionResult> {
  const contactId = readContactId(formData);

  if (contactId === null) {
    return {
      ok: false,
      code: "validation_error"
    };
  }

  const result = await setInboxNeedsFollowUp({
    contactId,
    needsFollowUp
  });

  if (!result.ok) {
    return result;
  }

  revalidateInboxContact(contactId);

  return {
    ok: true,
    contactId,
    needsFollowUp
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
