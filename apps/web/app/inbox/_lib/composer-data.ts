import type { InboxComposerAliasOption } from "./view-models";
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
  const projectDimensions =
    await runtime.repositories.projectDimensions.listByIds(projectIds);
  const cachedContentEntries = await Promise.all(
    projectIds.map(async (projectId) => {
      return [
        projectId,
        await runtime.repositories.aiKnowledge.hasProjectNotionContent(projectId),
      ] as const;
    }),
  );
  const projectById = new Map(
    projectDimensions.map((project) => [project.projectId, project])
  );
  const hasCachedContentByProjectId = new Map(cachedContentEntries);

  return aliases.flatMap((alias): readonly InboxComposerAliasOption[] => {
    if (alias.projectId === null) {
      return [];
    }

    const project = projectById.get(alias.projectId);

    if (project === undefined) {
      return [];
    }

    return [
      {
        id: alias.id,
        alias: alias.alias,
        projectId: alias.projectId,
        projectName: project.projectName,
        isAiConfigured,
        hasCachedContent: hasCachedContentByProjectId.get(alias.projectId) === true,
        isAiReady:
          project.isActive === true &&
          isAiConfigured &&
          hasCachedContentByProjectId.get(alias.projectId) === true,
      },
    ];
  });
}
