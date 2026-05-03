import type { ContactRecord } from "@as-comms/contracts";

export type ContactInsertRecord = ContactRecord;

export interface ContactResolutionInput {
  readonly phoneE164: string;
  readonly readContacts: {
    readonly findByPrimaryPhone: (
      phoneE164: string,
    ) => Promise<ContactRecord | null>;
  };
  readonly writeContacts: {
    readonly upsert: (record: ContactInsertRecord) => Promise<ContactRecord>;
  };
  readonly clock: { readonly now: () => Date };
  readonly idGenerator: () => string;
}

export interface ContactResolutionResult {
  readonly contact: ContactRecord;
  readonly isNewlyCreated: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return (error as { readonly code?: unknown }).code === "23505";
}

export function formatUnknownPhoneDisplayName(phoneE164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phoneE164);

  if (match === null) {
    return `Unknown (${phoneE164})`;
  }

  const area = match[1] ?? "";
  const prefix = match[2] ?? "";
  const line = match[3] ?? "";
  return `Unknown (+1 ${area} ${prefix} ${line})`;
}

export async function resolveContactByPhone(
  input: ContactResolutionInput,
): Promise<ContactResolutionResult> {
  const existing = await input.readContacts.findByPrimaryPhone(input.phoneE164);

  if (existing !== null) {
    return {
      contact: existing,
      isNewlyCreated: false,
    };
  }

  const nowIso = input.clock.now().toISOString();

  try {
    const created = await input.writeContacts.upsert({
      id: input.idGenerator(),
      salesforceContactId: null,
      displayName: formatUnknownPhoneDisplayName(input.phoneE164),
      primaryEmail: null,
      primaryPhone: input.phoneE164,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    return {
      contact: created,
      isNewlyCreated: true,
    };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const raced = await input.readContacts.findByPrimaryPhone(input.phoneE164);

    if (raced === null) {
      throw error;
    }

    return {
      contact: raced,
      isNewlyCreated: false,
    };
  }
}
