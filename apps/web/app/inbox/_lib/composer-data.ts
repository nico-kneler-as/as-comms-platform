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
  const approvedKnowledgeEntries = await Promise.all(
    projectIds.map(async (projectId) => {
      const entries = await runtime.repositories.projectKnowledge.list({
        projectId,
        approvedOnly: true,
      });

      return [projectId, entries.length > 0] as const;
    }),
  );
  const projectById = new Map(
    projectDimensions.map((project) => [project.projectId, project])
  );
  const hasApprovedKnowledgeByProjectId = new Map(approvedKnowledgeEntries);

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
        hasApprovedKnowledge:
          hasApprovedKnowledgeByProjectId.get(alias.projectId) === true,
        isAiReady:
          project.isActive === true &&
          isAiConfigured &&
          hasApprovedKnowledgeByProjectId.get(alias.projectId) === true,
      },
    ];
  });
}
