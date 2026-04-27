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

    return [
      {
        id: alias.id,
        alias: alias.alias,
        projectId: alias.projectId,
        projectName: project.projectName,
        isAiConfigured,
        hasCachedContent: hasCachedContentByProjectId.has(alias.projectId),
        isAiReady:
          project.isActive === true &&
          isAiConfigured &&
          hasCachedContentByProjectId.has(alias.projectId),
      },
    ];
  });
}
