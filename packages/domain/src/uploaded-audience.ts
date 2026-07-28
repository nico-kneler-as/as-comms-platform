import type { BroadcastUploadedRecipientRecord } from "@as-comms/contracts";

import type { ContactRepository } from "./repositories.js";
import type { AudienceMember } from "./campaign-types.js";
import { normalizeAliasEmail } from "./broadcast-email-render.js";
import { normalizeEmailAddress } from "./normalization.js";
import type {
  ProjectAliasesRepository,
  SettingsProjectsRepository,
} from "./settings/repositories.js";

interface UploadedAudienceRepositories {
  readonly uploadedRecipients: {
    listForRun(runId: string): Promise<
      readonly BroadcastUploadedRecipientRecord[]
    >;
  };
  readonly contacts: Pick<ContactRepository, "listAll">;
  readonly settingsProjects: Pick<SettingsProjectsRepository, "findById">;
  readonly settingsAliases: Pick<ProjectAliasesRepository, "findByAlias">;
}

async function resolveProjectContext(
  repositories: UploadedAudienceRepositories,
  input: {
    readonly fromEmail?: string | null;
    readonly projectId?: string | null;
  },
): Promise<{
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly aliasEmail: string | null;
}> {
  const aliasEmail = normalizeAliasEmail(input.fromEmail ?? null);
  const resolvedProjectId =
    input.projectId ??
    (aliasEmail === null
      ? null
      : (await repositories.settingsAliases.findByAlias(aliasEmail))
          ?.projectId ?? null);

  if (resolvedProjectId === null) {
    return {
      projectId: null,
      projectName: null,
      aliasEmail,
    };
  }

  return {
    projectId: resolvedProjectId,
    projectName:
      (await repositories.settingsProjects.findById(resolvedProjectId))
        ?.projectName ?? null,
    aliasEmail,
  };
}

export async function resolveUploadedAudienceForRun(
  repositories: UploadedAudienceRepositories,
  input: {
    readonly runId: string;
    readonly fromEmail?: string | null;
    readonly projectId?: string | null;
  },
): Promise<readonly AudienceMember[]> {
  const uploadedRecipients =
    await repositories.uploadedRecipients.listForRun(input.runId);
  if (uploadedRecipients.length === 0) {
    return [];
  }

  const contactsByEmail = new Map(
    (await repositories.contacts.listAll())
      .filter(
        (contact) => (contact.primaryEmail?.trim().length ?? 0) > 0,
      )
      .flatMap((contact) => {
        const normalizedEmail = normalizeEmailAddress(contact.primaryEmail ?? "");
        return normalizedEmail === null
          ? []
          : ([[normalizedEmail, contact]] as const);
      }),
  );
  const projectContext = await resolveProjectContext(repositories, input);

  return uploadedRecipients.map((recipient) => ({
    contactId:
      contactsByEmail.get(normalizeEmailAddress(recipient.email) ?? "")?.id ??
      null,
    newsletterSubscriberId: null,
    frozenEmail: recipient.email,
    frozenFirstName: recipient.firstName,
    frozenProjectName: projectContext.projectName,
    frozenProjectId: projectContext.projectId,
    frozenAliasEmail: projectContext.aliasEmail,
  }));
}
