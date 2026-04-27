import type { Task } from "graphile-worker";

import {
  notionKnowledgeSyncJobName,
  notionKnowledgeSyncPayloadSchema,
} from "@as-comms/contracts";

import {
  readNotionKnowledgeSyncConfig,
  runNotionKnowledgeSync,
  type NotionKnowledgeSyncConfig,
  type NotionKnowledgeSyncDependencies,
} from "./sync.js";

export { notionKnowledgeSyncJobName, notionKnowledgeSyncPayloadSchema };
export type { NotionKnowledgeSyncConfig, NotionKnowledgeSyncDependencies };
export { readNotionKnowledgeSyncConfig };

export function createNotionKnowledgeSyncTask(
  dependencies: NotionKnowledgeSyncDependencies,
): Task {
  return async (payload) => {
    await runNotionKnowledgeSync(
      dependencies,
      notionKnowledgeSyncPayloadSchema.parse(payload),
    );
  };
}
