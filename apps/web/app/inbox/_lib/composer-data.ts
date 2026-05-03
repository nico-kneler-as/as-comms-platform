import type {
  InboxComposerAliasOption,
  InboxSmsSenderOption,
} from "./view-models";
import { getAiProviderConfig } from "@/src/server/ai/provider";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

export async function getInboxComposerAliases(): Promise<
  readonly InboxComposerAliasOption[]
> {
  const runtime = await getStage1WebRuntime();
  const aliases = await runtime.settings.aliases.listAssigned();
  const aiProvider = getAiProviderConfig();
  const isAiConfigured = aiProvider.invokeModel !== null;
  const projectIds = Array.from(
    new Set(
      aliases
        .map((alias) => alias.projectId)
        .filter((projectId): projectId is string => projectId !== null)
    )
  );
  const [projectDimensions, projectIdsWithCachedContent] = await Promise.all([
    runtime.repositories.projectDimensions.listByIds(projectIds),
    runtime.repositories.aiKnowledge.findProjectIdsWithNotionContent(projectIds),
  ]);
  const projectById = new Map(
    projectDimensions.map((project) => [project.projectId, project])
  );
  const hasCachedContentByProjectId = new Set(projectIdsWithCachedContent);

  return aliases.flatMap((alias): readonly InboxComposerAliasOption[] => {
    if (alias.projectId === null) {
      return [];
    }

    const project = projectById.get(alias.projectId);

    if (project === undefined) {
      return [];
    }

    // Prefer the operator-facing alias label over the verbose Salesforce
    // project name (e.g. "PNW Biodiversity" not "Passive Acoustic
    // Monitoring of Pacific Northwest Forests"). Falls back to the full
    // name when the alias is null/empty.
    const trimmedAlias = project.projectAlias?.trim() ?? "";
    const projectDisplayName =
      trimmedAlias.length > 0 ? trimmedAlias : project.projectName;

    return [
      {
        id: alias.id,
        alias: alias.alias,
        projectId: alias.projectId,
        projectName: projectDisplayName,
        isAiConfigured,
        hasCachedContent: hasCachedContentByProjectId.has(alias.projectId),
        isAiReady: project.isActive === true && isAiConfigured,
      },
    ];
  });
}

export async function getInboxSmsSenders(): Promise<
  readonly InboxSmsSenderOption[]
> {
  const runtime = await getStage1WebRuntime();
  const senders = await runtime.settings.smsSenders.listActive();

  return senders.map((sender) => ({
    id: sender.id,
    phoneE164: sender.phoneE164,
    displayName: sender.displayName,
  }));
}
