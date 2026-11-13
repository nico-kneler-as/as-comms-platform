import type { AudienceListMemberRecord } from "@as-comms/contracts";

import { readFirstName } from "./audience-resolver.js";
import { normalizeAliasEmail } from "./broadcast-email-render.js";
import type { AudienceMember } from "./campaign-types.js";
import { normalizeEmailAddress } from "./normalization.js";
import type { ContactRepository } from "./repositories.js";

interface AudienceListRepositories {
  readonly audienceLists: {
    listMembers(listId: string): Promise<readonly AudienceListMemberRecord[]>;
  };
  readonly contacts: Pick<ContactRepository, "listAll">;
}

export async function resolveAudienceListForRun(
  repositories: AudienceListRepositories,
  input: {
    readonly listId: string;
    readonly fromEmail?: string | null;
  },
): Promise<readonly AudienceMember[]> {
  const members = await repositories.audienceLists.listMembers(input.listId);
  if (members.length === 0) {
    return [];
  }

  const contactsByEmail = new Map(
    (await repositories.contacts.listAll()).flatMap((contact) => {
      const normalizedEmail = normalizeEmailAddress(contact.primaryEmail ?? "");
      return normalizedEmail === null
        ? []
        : ([[normalizedEmail, contact]] as const);
    }),
  );
  const aliasEmail = normalizeAliasEmail(input.fromEmail ?? null);

  return members.map((member) => {
    const contact = contactsByEmail.get(member.normalizedEmail) ?? null;
    const memberFirstName = member.firstName?.trim() ?? "";

    return {
      contactId: contact?.id ?? null,
      newsletterSubscriberId: null,
      frozenEmail: member.normalizedEmail,
      frozenFirstName:
        memberFirstName.length > 0
          ? memberFirstName
          : contact === null
            ? null
            : readFirstName(contact.displayName),
      frozenProjectName: null,
      frozenProjectId: null,
      frozenAliasEmail: aliasEmail,
    };
  });
}
