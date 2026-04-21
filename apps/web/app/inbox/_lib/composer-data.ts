import type { InboxComposerAliasOption } from "./view-models";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

export async function getInboxComposerAliases(): Promise<
  readonly InboxComposerAliasOption[]
> {
  const runtime = await getStage1WebRuntime();
  const aliases = await runtime.settings.aliases.listAssigned();
  const projectIds = Array.from(
    new Set(
      aliases
        .map((alias) => alias.projectId)
        .filter((projectId): projectId is string => projectId !== null)
    )
  );
  const projectDimensions =
    await runtime.repositories.projectDimensions.listByIds(projectIds);
  const projectNameById = new Map(
    projectDimensions.map((project) => [project.projectId, project.projectName])
  );

  return aliases.flatMap((alias): readonly InboxComposerAliasOption[] => {
    if (alias.projectId === null) {
      return [];
    }

    const projectName = projectNameById.get(alias.projectId);

    if (projectName === undefined) {
      return [];
    }

    return [
      {
        id: alias.id,
        alias: alias.alias,
        projectId: alias.projectId,
        projectName,
      },
    ];
  });
}
