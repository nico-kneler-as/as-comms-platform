import type { ContactIdentityKind, ContactRecord } from "@as-comms/contracts";

import { normalizeEmailAddress } from "./normalization.js";
import type { ContactIdentityRepository, ContactRepository } from "./repositories.js";

export type ContactEmailResolutionStatus =
  | "matched"
  | "no_contact_match"
  | "ambiguous_match";

export interface ContactEmailResolution {
  readonly normalizedEmail: string;
  readonly status: ContactEmailResolutionStatus;
  readonly contactId: string | null;
}

interface ContactEmailResolutionRepositories {
  readonly contacts: Pick<
    ContactRepository,
    "listByIds" | "listByNormalizedPrimaryEmails"
  >;
  readonly contactIdentities: Pick<
    ContactIdentityRepository,
    "listByNormalizedValues"
  >;
}

function buildUniqueNormalizedEmails(
  normalizedEmails: readonly string[],
): readonly string[] {
  const seenEmails = new Set<string>();
  const uniqueEmails: string[] = [];

  for (const email of normalizedEmails) {
    const normalizedEmail = normalizeEmailAddress(email);
    if (normalizedEmail === null || seenEmails.has(normalizedEmail)) {
      continue;
    }

    seenEmails.add(normalizedEmail);
    uniqueEmails.push(normalizedEmail);
  }

  return uniqueEmails;
}

function readPrimaryEmail(contact: ContactRecord): string | null {
  return normalizeEmailAddress(contact.primaryEmail ?? "");
}

export async function resolveContactsByEmail(input: {
  readonly normalizedEmails: readonly string[];
  readonly repositories: ContactEmailResolutionRepositories;
}): Promise<readonly ContactEmailResolution[]> {
  const normalizedEmails = buildUniqueNormalizedEmails(input.normalizedEmails);
  if (normalizedEmails.length === 0) {
    return [];
  }

  const [primaryEmailContacts, emailIdentities] = await Promise.all([
    input.repositories.contacts.listByNormalizedPrimaryEmails(normalizedEmails),
    input.repositories.contactIdentities.listByNormalizedValues({
      kind: "email" satisfies ContactIdentityKind,
      normalizedValues: normalizedEmails,
    }),
  ]);
  const contactIdsByEmail = new Map<string, Set<string>>(
    normalizedEmails.map((email) => [email, new Set<string>()] as const),
  );

  for (const contact of primaryEmailContacts) {
    const normalizedPrimaryEmail = readPrimaryEmail(contact);
    if (normalizedPrimaryEmail === null) {
      continue;
    }

    const contactIds = contactIdsByEmail.get(normalizedPrimaryEmail);
    contactIds?.add(contact.id);
  }

  for (const identity of emailIdentities) {
    const contactIds = contactIdsByEmail.get(identity.normalizedValue);
    contactIds?.add(identity.contactId);
  }

  return normalizedEmails.map((normalizedEmail) => {
    const matchedContactIds = [...(contactIdsByEmail.get(normalizedEmail) ?? [])];
    if (matchedContactIds.length === 1) {
      return {
        normalizedEmail,
        status: "matched",
        contactId: matchedContactIds[0] ?? null,
      } satisfies ContactEmailResolution;
    }

    return {
      normalizedEmail,
      status:
        matchedContactIds.length === 0
          ? "no_contact_match"
          : "ambiguous_match",
      contactId: null,
    } satisfies ContactEmailResolution;
  });
}
