import { and, eq, ne } from "drizzle-orm";

import {
  aiKnowledgeEntries,
  projectDimensions,
  type Stage1Database,
} from "@as-comms/db";
import { notionKnowledgeSyncPayloadSchema } from "@as-comms/contracts";
import type { IntegrationHealthRepository } from "@as-comms/domain";
import {
  NotionProviderError,
  createNotionClient,
  describeNotionError,
  fetchPageContent,
  normalizeNotionId,
  type NotionClient,
} from "@as-comms/integrations";

import {
  upsertAiKnowledgeEntry,
  type UpsertAiKnowledgeEntryInput,
  type UpsertAiKnowledgeEntryResult,
} from "./upsert.js";

const NOTION_SERVICE_ID = "notion";

export interface NotionKnowledgeSyncConfig {
  readonly apiKey: string | null;
  readonly generalTrainingPageId: string | null;
}

export interface NotionKnowledgeSyncDependencies {
  readonly db: Stage1Database;
  readonly integrationHealth: IntegrationHealthRepository;
  readonly notion: NotionKnowledgeSyncConfig;
  readonly createClient?: (env: { readonly NOTION_API_KEY: string }) => NotionClient;
  readonly logger?: Pick<Console, "error" | "info" | "warn">;
  readonly now?: () => Date;
  readonly upsertEntry?: (
    db: Stage1Database,
    input: UpsertAiKnowledgeEntryInput,
  ) => Promise<UpsertAiKnowledgeEntryResult>;
}

export type NotionKnowledgeSyncErrorCode =
  | "not_configured"
  | "invalid_source"
  | "project_missing"
  | "notion_stale"
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_unauthorized"
  | "provider_unavailable";

export type NotionKnowledgeSyncResult =
  | {
      readonly ok: true;
      readonly projectId: string;
      readonly sourceId: string;
      readonly syncedAt: string;
      readonly generalTrainingUpdated: boolean;
    }
  | {
      readonly ok: false;
      readonly projectId: string;
      readonly code: NotionKnowledgeSyncErrorCode;
      readonly message: string;
      readonly retryable: boolean;
    };

function readOptionalEnvValue(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readNotionKnowledgeSyncConfig(
  env: NodeJS.ProcessEnv,
): NotionKnowledgeSyncConfig {
  return {
    apiKey: readOptionalEnvValue(env.NOTION_API_KEY),
    generalTrainingPageId: readOptionalEnvValue(
      env.NOTION_GENERAL_TRAINING_PAGE_ID,
    ),
  };
}

function parseNotionPageId(url: string): string | null {
  const match = url.match(
    /([0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/iu,
  );

  if (match === null) {
    return null;
  }

  try {
    const pageId = match[1];
    return pageId === undefined ? null : normalizeNotionId(pageId);
  } catch {
    return null;
  }
}

async function loadProjectRecord(
  db: Stage1Database,
  projectId: string,
): Promise<{
  readonly projectId: string;
  readonly projectName: string;
  readonly aiKnowledgeUrl: string | null;
} | null> {
  const [row] = await db
    .select({
      projectId: projectDimensions.projectId,
      projectName: projectDimensions.projectName,
      aiKnowledgeUrl: projectDimensions.aiKnowledgeUrl,
    })
    .from(projectDimensions)
    .where(eq(projectDimensions.projectId, projectId))
    .limit(1);

  return row ?? null;
}

function mapSyncError(
  projectId: string,
  error: unknown,
): Extract<NotionKnowledgeSyncResult, { ok: false }> {
  const classified =
    error instanceof NotionProviderError
      ? error
      : error instanceof Error
        ? new NotionProviderError({
            code: "unexpected",
            message: error.message,
            retryable: false,
          })
        : new NotionProviderError({
            code: "unexpected",
            message: "Notion sync failed with an unknown error.",
            retryable: false,
          });

  switch (classified.code) {
    case "timeout":
      return {
        ok: false,
        projectId,
        code: "provider_timeout",
        message: "The Notion sync timed out. Try again.",
        retryable: true,
      };
    case "rate_limited":
      return {
        ok: false,
        projectId,
        code: "provider_rate_limited",
        message: "Notion rate-limited this sync. Try again shortly.",
        retryable: true,
      };
    case "unauthorized":
      return {
        ok: false,
        projectId,
        code: "provider_unauthorized",
        message: "The Notion integration is not authorized for this page.",
        retryable: false,
      };
    case "not_found":
      return {
        ok: false,
        projectId,
        code: "notion_stale",
        message: "The configured Notion page could not be found.",
        retryable: false,
      };
    default:
      return {
        ok: false,
        projectId,
        code: "provider_unavailable",
        message: describeNotionError(classified),
        retryable: classified.retryable,
      };
  }
}

async function upsertGeneralTraining(input: {
  readonly client: NotionClient;
  readonly config: NotionKnowledgeSyncConfig;
  readonly db: Stage1Database;
  readonly now: Date;
  readonly upsertEntry: (
    db: Stage1Database,
    payload: UpsertAiKnowledgeEntryInput,
  ) => Promise<UpsertAiKnowledgeEntryResult>;
  readonly logger: Pick<Console, "warn">;
}): Promise<boolean> {
  if (input.config.generalTrainingPageId === null) {
    return false;
  }

  try {
    const generalPage = await fetchPageContent(
      input.client,
      input.config.generalTrainingPageId,
    );

    await input.upsertEntry(input.db, {
      scope: "global",
      scopeKey: null,
      sourceProvider: "notion",
      sourceId: normalizeNotionId(input.config.generalTrainingPageId),
      sourceUrl: generalPage.url,
      title: generalPage.title,
      content: generalPage.markdown,
      metadata: {},
      sourceLastEditedAt: new Date(generalPage.lastEditedTime),
      syncedAt: input.now,
    });

    return true;
  } catch (error) {
    input.logger.warn(
      `General Notion training refresh failed: ${describeNotionError(error)}`,
    );
    return false;
  }
}

async function markIntegrationHealth(input: {
  readonly integrationHealth: IntegrationHealthRepository;
  readonly status:
    | "healthy"
    | "needs_attention"
    | "disconnected"
    | "not_configured";
  readonly detail: string | null;
  readonly now: Date;
}): Promise<void> {
  await input.integrationHealth.seedDefaults();
  const existing =
    (await input.integrationHealth.findById(NOTION_SERVICE_ID)) ?? {
      id: NOTION_SERVICE_ID,
      serviceName: NOTION_SERVICE_ID,
      category: "knowledge" as const,
      status: "not_checked" as const,
      lastCheckedAt: null,
      degradedSinceAt: null,
      lastAlertSentAt: null,
      detail: null,
      metadataJson: {},
      createdAt: input.now.toISOString(),
      updatedAt: input.now.toISOString(),
    };

  const checkedAt = input.now.toISOString();
  await input.integrationHealth.upsert({
    ...existing,
    status: input.status,
    lastCheckedAt: checkedAt,
    degradedSinceAt:
      input.status === "healthy"
        ? null
        : existing.degradedSinceAt ?? checkedAt,
    detail: input.detail,
    updatedAt: checkedAt,
  });
}

export async function runNotionKnowledgeSync(
  dependencies: NotionKnowledgeSyncDependencies,
  rawPayload: unknown,
): Promise<NotionKnowledgeSyncResult> {
  const logger = dependencies.logger ?? console;
  const now = dependencies.now?.() ?? new Date();
  const upsertEntry = dependencies.upsertEntry ?? upsertAiKnowledgeEntry;
  const payload = notionKnowledgeSyncPayloadSchema.parse(rawPayload);

  if (dependencies.notion.apiKey === null) {
    await markIntegrationHealth({
      integrationHealth: dependencies.integrationHealth,
      status: "not_configured",
      detail: "NOTION_API_KEY is not configured.",
      now,
    });
    return {
      ok: false,
      projectId: payload.projectId,
      code: "not_configured",
      message: "Notion sync is not configured.",
      retryable: false,
    };
  }

  const project = await loadProjectRecord(dependencies.db, payload.projectId);
  if (project === null) {
    return {
      ok: false,
      projectId: payload.projectId,
      code: "project_missing",
      message: "The project could not be found.",
      retryable: false,
    };
  }

  if (project.aiKnowledgeUrl === null) {
    return {
      ok: false,
      projectId: payload.projectId,
      code: "invalid_source",
      message: "Set a Notion page URL before syncing AI knowledge.",
      retryable: false,
    };
  }

  const notionPageId = parseNotionPageId(project.aiKnowledgeUrl);
  if (notionPageId === null) {
    return {
      ok: false,
      projectId: payload.projectId,
      code: "invalid_source",
      message: "The configured URL does not contain a valid Notion page ID.",
      retryable: false,
    };
  }

  const client = (dependencies.createClient ?? createNotionClient)({
    NOTION_API_KEY: dependencies.notion.apiKey,
  });

  try {
    const page = await fetchPageContent(client, notionPageId);

    await upsertEntry(dependencies.db, {
      scope: "project",
      scopeKey: payload.projectId,
      sourceProvider: "notion",
      sourceId: notionPageId,
      sourceUrl: page.url ?? project.aiKnowledgeUrl,
      title: page.title ?? project.projectName,
      content: page.markdown,
      metadata: {
        projectId: payload.projectId,
        trigger: payload.trigger,
      },
      sourceLastEditedAt: new Date(page.lastEditedTime),
      syncedAt: now,
    });

    await dependencies.db
      .delete(aiKnowledgeEntries)
      .where(
        and(
          eq(aiKnowledgeEntries.scope, "project"),
          eq(aiKnowledgeEntries.scopeKey, payload.projectId),
          eq(aiKnowledgeEntries.sourceProvider, "notion"),
          ne(aiKnowledgeEntries.sourceId, notionPageId),
        ),
      );

    await dependencies.db
      .update(projectDimensions)
      .set({
        aiKnowledgeSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(projectDimensions.projectId, payload.projectId));

    const generalTrainingUpdated = await upsertGeneralTraining({
      client,
      config: dependencies.notion,
      db: dependencies.db,
      now,
      upsertEntry,
      logger,
    });

    await markIntegrationHealth({
      integrationHealth: dependencies.integrationHealth,
      status: "healthy",
      detail: null,
      now,
    });

    logger.info(
      JSON.stringify({
        event: "notion_knowledge_sync.completed",
        projectId: payload.projectId,
        trigger: payload.trigger,
        sourceId: notionPageId,
        generalTrainingUpdated,
        syncedAt: now.toISOString(),
      }),
    );

    return {
      ok: true,
      projectId: payload.projectId,
      sourceId: notionPageId,
      syncedAt: now.toISOString(),
      generalTrainingUpdated,
    };
  } catch (error) {
    const result = mapSyncError(payload.projectId, error);

    await markIntegrationHealth({
      integrationHealth: dependencies.integrationHealth,
      status:
        result.code === "provider_unauthorized" ||
        result.code === "notion_stale"
          ? "disconnected"
          : "needs_attention",
      detail: result.message,
      now,
    });

    logger.error(
      JSON.stringify({
        event: "notion_knowledge_sync.failed",
        projectId: payload.projectId,
        trigger: payload.trigger,
        code: result.code,
        detail: result.message,
      }),
    );

    return result;
  }
}
