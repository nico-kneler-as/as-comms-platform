import type { Task } from "graphile-worker";

import {
  synthesizeProjectKnowledgeJobName,
  synthesizeProjectKnowledgePayloadSchema,
  type ProjectDimensionRecord,
} from "@as-comms/contracts";
import type { ProjectDimensionRepository } from "@as-comms/domain";

export const pollAiKnowledgeAutoSyncJobName =
  "poll-ai-knowledge-auto-sync" as const;

const dailyIntervalMs = 24 * 60 * 60 * 1000;
const weeklyIntervalMs = 7 * dailyIntervalMs;

export interface PollAiKnowledgeAutoSyncTaskDependencies {
  readonly projectDimensions: Pick<ProjectDimensionRepository, "listActive">;
  readonly logger?: Pick<Console, "debug" | "info">;
  readonly now?: () => Date;
}

function hasConfiguredSources(project: ProjectDimensionRecord): boolean {
  return (project.aiKnowledgeSources ?? []).some((source) => source.enabled);
}

function hasProjectAlias(project: ProjectDimensionRecord): boolean {
  return (project.projectAlias?.trim().length ?? 0) > 0;
}

function isDueForAutoSync(project: ProjectDimensionRecord, now: Date): boolean {
  const lastSynthesizedAt =
    project.aiOptimizedSynthesizedAt == null
      ? Number.NaN
      : Date.parse(project.aiOptimizedSynthesizedAt);

  if (Number.isNaN(lastSynthesizedAt)) {
    return true;
  }

  const elapsedMs = now.getTime() - lastSynthesizedAt;

  switch (project.aiAutoSyncSchedule ?? "never") {
    case "daily":
      return elapsedMs >= dailyIntervalMs;
    case "weekly":
      return elapsedMs >= weeklyIntervalMs;
    case "never":
    default:
      return false;
  }
}

export function createPollAiKnowledgeAutoSyncTask(
  dependencies: PollAiKnowledgeAutoSyncTaskDependencies,
): Task {
  const logger = dependencies.logger ?? console;
  const now = dependencies.now ?? (() => new Date());

  return async (_rawPayload, helpers) => {
    const projects = await dependencies.projectDimensions.listActive();
    const eligibleProjects = projects.filter(
      (project) =>
        (project.aiAutoSyncSchedule ?? "never") !== "never" &&
        hasConfiguredSources(project) &&
        hasProjectAlias(project),
    );
    const startedAt = now();
    let enqueued = 0;

    for (const project of eligibleProjects) {
      if (!isDueForAutoSync(project, startedAt)) {
        continue;
      }

      await helpers.addJob(
        synthesizeProjectKnowledgeJobName,
        synthesizeProjectKnowledgePayloadSchema.parse({
          projectId: project.projectId,
          skipIfHashUnchanged: true,
        }),
        {
          jobKey: `ai-knowledge-auto-sync:${project.projectId}`,
          jobKeyMode: "replace",
          maxAttempts: 1,
        },
      );
      enqueued += 1;
    }

    const message = `checked ${String(eligibleProjects.length)} projects, enqueued ${String(enqueued)} syntheses`;
    if (typeof logger.debug === "function") {
      logger.debug(message);
      return;
    }
    logger.info(message);
  };
}
