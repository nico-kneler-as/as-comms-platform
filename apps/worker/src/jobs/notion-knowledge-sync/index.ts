import type { Task } from "graphile-worker";

import {
  readNotionKnowledgeSyncConfig,
  runNotionKnowledgeSync,
  type NotionKnowledgeSyncConfig,
  type NotionKnowledgeSyncDependencies
} from "./sync.js";

export const notionKnowledgeSyncJobName = "notion-knowledge-sync" as const;

export type { NotionKnowledgeSyncConfig, NotionKnowledgeSyncDependencies };

export { readNotionKnowledgeSyncConfig };

export function createNotionKnowledgeSyncTask(
  dependencies: NotionKnowledgeSyncDependencies
): Task {
  return async () => {
    await runNotionKnowledgeSync(dependencies);
  };
}
