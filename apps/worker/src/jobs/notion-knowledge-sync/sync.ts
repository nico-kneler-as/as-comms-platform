import { and, eq, inArray } from "drizzle-orm";

import {
  aiKnowledgeEntries,
  projectDimensions,
  type Stage1Database
} from "@as-comms/db";
import type { IntegrationHealthRecord } from "@as-comms/contracts";
import type { IntegrationHealthRepository } from "@as-comms/domain";
import {
  createNotionClient,
  describeNotionError,
  fetchPageContent,
  healthCheck,
  normalizeNotionId,
  queryDatabase,
  type DatabaseRow,
  type NotionClient
} from "@as-comms/integrations";

import {
  upsertAiKnowledgeEntry,
  type UpsertAiKnowledgeEntryInput,
  type UpsertAiKnowledgeEntryResult
} from "./upsert.js";

const NOTION_SERVICE_ID = "notion";
const PAGE_FETCH_DELAY_MS = 500;

export interface NotionKnowledgeSyncConfig {
  readonly apiKey: string | null;
  readonly generalTrainingPageId: string | null;
  readonly projectTrainingDatabaseId: string | null;
}

export interface NotionKnowledgeSyncDependencies {
  readonly db: Stage1Database;
  readonly integrationHealth: IntegrationHealthRepository;
  readonly notion: NotionKnowledgeSyncConfig;
  readonly createClient?: (env: { readonly NOTION_API_KEY: string }) => NotionClient;
  readonly logger?: Pick<Console, "error" | "info" | "warn">;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly upsertEntry?: (
    db: Stage1Database,
    input: UpsertAiKnowledgeEntryInput
  ) => Promise<UpsertAiKnowledgeEntryResult>;
}

export type NotionKnowledgeSyncResult =
  | {
      readonly status: "not_configured";
    }
  | {
      readonly status: "error";
      readonly projectsSyncedCount: number;
      readonly seenSourceIds: readonly string[];
      readonly errorDetail: string;
    }
  | {
      readonly status: "healthy";
      readonly knowledgeEntriesTotal: number;
      readonly projectsSyncedCount: number;
      readonly orphanRowsCount: number;
      readonly deletedSourceIds: readonly string[];
      readonly seenSourceIds: readonly string[];
    };

function readOptionalEnvValue(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readNotionKnowledgeSyncConfig(
  env: NodeJS.ProcessEnv
): NotionKnowledgeSyncConfig {
  return {
    apiKey: readOptionalEnvValue(env.NOTION_API_KEY),
    generalTrainingPageId: readOptionalEnvValue(
      env.NOTION_GENERAL_TRAINING_PAGE_ID
    ),
    projectTrainingDatabaseId: readOptionalEnvValue(
      env.NOTION_PROJECT_TRAINING_DATABASE_ID
    )
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function extractRichText(value: unknown): string | null {
  if (!isUnknownArray(value)) {
    return null;
  }

  const text = value
    .map((item) => {
      if (!isRecord(item)) {
        return "";
      }

      const plainText = item.plain_text;
      if (typeof plainText === "string") {
        return plainText;
      }

      return "";
    })
    .join("")
    .trim();

  return text.length > 0 ? text : null;
}

function extractPlainTextProperty(
  properties: Record<string, unknown>,
  propertyName: string
): string | null {
  const property = properties[propertyName];
  if (typeof property !== "object" || property === null || !("type" in property)) {
    return null;
  }

  const propertyRecord = property as Record<string, unknown>;

  switch (propertyRecord.type) {
    case "title":
      return extractRichText(propertyRecord.title);
    case "rich_text":
      return extractRichText(propertyRecord.rich_text);
    case "select":
      if (
        typeof propertyRecord.select === "object" &&
        propertyRecord.select !== null &&
        "name" in propertyRecord.select &&
        typeof propertyRecord.select.name === "string"
      ) {
        const name = propertyRecord.select.name.trim();
        return name.length > 0 ? name : null;
      }

      return null;
    default:
      return null;
  }
}

function extractUrlProperty(
  properties: Record<string, unknown>,
  propertyName: string
): string | null {
  const property = properties[propertyName];
  if (!isRecord(property)) {
    return null;
  }

  const propertyType = property.type;
  const url = property.url;
  if (
    propertyType === "url" &&
    typeof url === "string" &&
    url.trim().length > 0
  ) {
    return url.trim();
  }

  return null;
}

function extractMultiSelectProperty(
  properties: Record<string, unknown>,
  propertyName: string
): readonly string[] {
  const property = properties[propertyName];
  if (!isRecord(property) || property.type !== "multi_select") {
    return [];
  }

  const multiSelect = property.multi_select;
  if (!isUnknownArray(multiSelect)) {
    return [];
  }

  return multiSelect.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const name = item.name;
    return typeof name === "string" && name.trim().length > 0
      ? [name.trim()]
      : [];
  });
}

function extractCreatedTimeProperty(
  properties: Record<string, unknown>,
  propertyName: string
): string | null {
  const property = properties[propertyName];
  if (!isRecord(property)) {
    return null;
  }

  const propertyType = property.type;
  const createdTime = property.created_time;
  if (
    propertyType === "created_time" &&
    typeof createdTime === "string" &&
    createdTime.trim().length > 0
  ) {
    return createdTime;
  }

  return null;
}

function compactMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => {
      if (value === null || value === undefined) {
        return false;
      }

      if (Array.isArray(value)) {
        return value.length > 0;
      }

      if (typeof value === "string") {
        return value.trim().length > 0;
      }

      return true;
    })
  );
}

function buildProjectKnowledgeMetadata(
  row: DatabaseRow
): Record<string, unknown> {
  return compactMetadata({
    training_url: extractUrlProperty(row.properties, "Training URL"),
    internal_source_url: extractUrlProperty(
      row.properties,
      "Internal Source URL"
    ),
    public_project_url: extractUrlProperty(row.properties, "Public Project URL"),
    volunteer_homepage_url: extractUrlProperty(
      row.properties,
      "Volunteer Homepage URL"
    ),
    training_notes: extractPlainTextProperty(row.properties, "Training Notes"),
    season: extractPlainTextProperty(row.properties, "Season"),
    tags: extractMultiSelectProperty(row.properties, "Tags"),
    created_at: extractCreatedTimeProperty(row.properties, "Created")
  });
}

function compareIsoTimestamps(left: string, right: string): number {
  return left.localeCompare(right);
}

function isNotionSyncConfigured(
  config: NotionKnowledgeSyncConfig
): config is {
  readonly apiKey: string;
  readonly generalTrainingPageId: string;
  readonly projectTrainingDatabaseId: string;
} {
  return (
    config.apiKey !== null &&
    config.generalTrainingPageId !== null &&
    config.projectTrainingDatabaseId !== null
  );
}

function buildIntegrationHealthRecord(input: {
  readonly baseRecord: IntegrationHealthRecord | null;
  readonly checkedAt: string;
  readonly status: IntegrationHealthRecord["status"];
  readonly detail: string | null;
  readonly metadataJson?: Record<string, unknown>;
}): IntegrationHealthRecord {
  const metadataJson =
    input.metadataJson === undefined
      ? input.baseRecord?.metadataJson ?? {}
      : {
          ...(input.baseRecord?.metadataJson ?? {}),
          ...input.metadataJson
        };

  return {
    id: NOTION_SERVICE_ID,
    serviceName: "notion",
    category: "knowledge",
    status: input.status,
    lastCheckedAt: input.checkedAt,
    detail: input.detail,
    metadataJson,
    createdAt: input.baseRecord?.createdAt ?? input.checkedAt,
    updatedAt: input.checkedAt
  };
}

async function writeIntegrationHealth(
  repository: IntegrationHealthRepository,
  input: {
    readonly now: Date;
    readonly status: IntegrationHealthRecord["status"];
    readonly detail: string | null;
    readonly metadataJson?: Record<string, unknown>;
  }
): Promise<void> {
  await repository.seedDefaults();
  const existingRecord = await repository.findById(NOTION_SERVICE_ID);
  const recordInput = {
    baseRecord: existingRecord,
    checkedAt: input.now.toISOString(),
    status: input.status,
    detail: input.detail,
    ...(input.metadataJson === undefined
      ? {}
      : { metadataJson: input.metadataJson })
  };

  await repository.upsert(buildIntegrationHealthRecord(recordInput));
}

async function listKnownProjectIds(db: Stage1Database): Promise<Set<string>> {
  const rows = await db
    .select({
      projectId: projectDimensions.projectId
    })
    .from(projectDimensions);

  return new Set(rows.map((row) => row.projectId));
}

async function collectProjectRows(input: {
  readonly client: NotionClient;
  readonly databaseId: string;
  readonly knownProjectIds: ReadonlySet<string>;
  readonly logger: Pick<Console, "warn">;
}): Promise<{
  readonly rowsByProjectId: ReadonlyMap<string, DatabaseRow>;
  readonly orphanRowsCount: number;
}> {
  const rowsByProjectId = new Map<string, DatabaseRow>();
  let orphanRowsCount = 0;

  for await (const row of queryDatabase(input.client, input.databaseId)) {
    const projectId = extractPlainTextProperty(row.properties, "Project ID")?.trim();

    if (projectId === undefined || projectId.length === 0) {
      input.logger.warn(
        `Skipping Notion Project Training row ${row.id} because Project ID is empty.`
      );
      continue;
    }

    if (!input.knownProjectIds.has(projectId)) {
      orphanRowsCount += 1;
      input.logger.warn(
        `Skipping Notion Project Training row ${row.id} because Project ID ${projectId} does not match any project_dimensions row.`
      );
      continue;
    }

    const existingRow = rowsByProjectId.get(projectId);
    if (existingRow === undefined) {
      rowsByProjectId.set(projectId, row);
      continue;
    }

    if (compareIsoTimestamps(row.lastEditedTime, existingRow.lastEditedTime) > 0) {
      input.logger.warn(
        `Duplicate Notion Project Training rows found for project ${projectId}; using ${row.id} and skipping ${existingRow.id}.`
      );
      rowsByProjectId.set(projectId, row);
      continue;
    }

    input.logger.warn(
      `Duplicate Notion Project Training rows found for project ${projectId}; using ${existingRow.id} and skipping ${row.id}.`
    );
  }

  return {
    rowsByProjectId,
    orphanRowsCount
  };
}

function buildProjectKnowledgeInput(input: {
  readonly projectId: string;
  readonly row: DatabaseRow;
  readonly pageContent: Awaited<ReturnType<typeof fetchPageContent>>;
  readonly syncedAt: Date;
}): UpsertAiKnowledgeEntryInput {
  return {
    scope: "project",
    scopeKey: input.projectId,
    sourceProvider: "notion",
    sourceId: normalizeNotionId(input.row.id),
    sourceUrl: input.pageContent.url,
    title:
      input.pageContent.title ??
      extractPlainTextProperty(input.row.properties, "Name"),
    content: input.pageContent.markdown,
    metadata: buildProjectKnowledgeMetadata(input.row),
    sourceLastEditedAt: new Date(input.pageContent.lastEditedTime),
    syncedAt: input.syncedAt
  };
}

function buildGlobalKnowledgeInput(input: {
  readonly pageId: string;
  readonly pageContent: Awaited<ReturnType<typeof fetchPageContent>>;
  readonly syncedAt: Date;
}): UpsertAiKnowledgeEntryInput {
  return {
    scope: "global",
    scopeKey: null,
    sourceProvider: "notion",
    sourceId: normalizeNotionId(input.pageId),
    sourceUrl: input.pageContent.url,
    title: null,
    content: input.pageContent.markdown,
    metadata: {},
    sourceLastEditedAt: new Date(input.pageContent.lastEditedTime),
    syncedAt: input.syncedAt
  };
}

async function reconcileRemovedKnowledgeEntries(input: {
  readonly db: Stage1Database;
  readonly seenSourceIds: ReadonlySet<string>;
}): Promise<readonly string[]> {
  const currentRows = await input.db
    .select({
      sourceId: aiKnowledgeEntries.sourceId
    })
    .from(aiKnowledgeEntries)
    .where(eq(aiKnowledgeEntries.sourceProvider, "notion"));

  const staleSourceIds = currentRows.flatMap((row) =>
    input.seenSourceIds.has(row.sourceId) ? [] : [row.sourceId]
  );

  if (staleSourceIds.length === 0) {
    return [];
  }

  await input.db
    .delete(aiKnowledgeEntries)
    .where(
      and(
        eq(aiKnowledgeEntries.sourceProvider, "notion"),
        inArray(aiKnowledgeEntries.sourceId, staleSourceIds)
      )
    );

  return staleSourceIds;
}

export async function runNotionKnowledgeSync(
  input: NotionKnowledgeSyncDependencies
): Promise<NotionKnowledgeSyncResult> {
  const logger = input.logger ?? console;
  const now = input.now ?? (() => new Date());
  const sleep =
    input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const upsertEntry = input.upsertEntry ?? upsertAiKnowledgeEntry;
  const checkedAt = now();

  if (!isNotionSyncConfigured(input.notion)) {
    await writeIntegrationHealth(input.integrationHealth, {
      now: checkedAt,
      status: "not_configured",
      detail:
        "Set NOTION_API_KEY, NOTION_GENERAL_TRAINING_PAGE_ID, and NOTION_PROJECT_TRAINING_DATABASE_ID to enable Notion knowledge sync."
    });

    return {
      status: "not_configured"
    };
  }

  const createClient = input.createClient ?? createNotionClient;
  const seenSourceIds = new Set<string>();
  let projectsSyncedCount = 0;

  try {
    const client = createClient({
      NOTION_API_KEY: input.notion.apiKey
    });
    const health = await healthCheck(client, {
      generalTrainingPageId: input.notion.generalTrainingPageId,
      projectTrainingDatabaseId: input.notion.projectTrainingDatabaseId
    });

    if (health.status === "error") {
      await writeIntegrationHealth(input.integrationHealth, {
        now: checkedAt,
        status: "needs_attention",
        detail: health.errorDetail
      });

      return {
        status: "error",
        projectsSyncedCount,
        seenSourceIds: [],
        errorDetail: health.errorDetail
      };
    }

    const globalSyncedAt = now();
    const generalPageContent = await fetchPageContent(
      client,
      input.notion.generalTrainingPageId
    );
    const generalResult = await upsertEntry(
      input.db,
      buildGlobalKnowledgeInput({
        pageId: input.notion.generalTrainingPageId,
        pageContent: generalPageContent,
        syncedAt: globalSyncedAt
      })
    );
    seenSourceIds.add(generalResult.row.sourceId);

    const knownProjectIds = await listKnownProjectIds(input.db);
    const { rowsByProjectId, orphanRowsCount } = await collectProjectRows({
      client,
      databaseId: input.notion.projectTrainingDatabaseId,
      knownProjectIds,
      logger
    });

    let projectIndex = 0;

    for (const [projectId, row] of rowsByProjectId.entries()) {
      if (projectIndex > 0) {
        await sleep(PAGE_FETCH_DELAY_MS);
      }

      const syncedAt = now();
      const pageContent = await fetchPageContent(client, row.id);

      await input.db.transaction(async (tx: Stage1Database) => {
        const result = await upsertEntry(
          tx,
          buildProjectKnowledgeInput({
            projectId,
            row,
            pageContent,
            syncedAt
          })
        );

        seenSourceIds.add(result.row.sourceId);

        await tx
          .update(projectDimensions)
          .set({
            aiKnowledgeSyncedAt: syncedAt,
            updatedAt: syncedAt
          })
          .where(eq(projectDimensions.projectId, projectId));
      });

      projectIndex += 1;
      projectsSyncedCount += 1;
    }

    const deletedSourceIds = await reconcileRemovedKnowledgeEntries({
      db: input.db,
      seenSourceIds
    });
    const successNow = now();

    await writeIntegrationHealth(input.integrationHealth, {
      now: successNow,
      status: "healthy",
      detail: null,
      metadataJson: {
        knowledgeEntriesTotal: seenSourceIds.size,
        projectsSyncedCount,
        orphanRowsCount,
        lastSuccessAt: successNow.toISOString()
      }
    });

    return {
      status: "healthy",
      knowledgeEntriesTotal: seenSourceIds.size,
      projectsSyncedCount,
      orphanRowsCount,
      deletedSourceIds,
      seenSourceIds: [...seenSourceIds]
    };
  } catch (error) {
    const errorDetail = describeNotionError(error);
    logger.error(`Notion knowledge sync failed: ${errorDetail}`);

    await writeIntegrationHealth(input.integrationHealth, {
      now: now(),
      status: "needs_attention",
      detail: errorDetail
    });

    return {
      status: "error",
      projectsSyncedCount,
      seenSourceIds: [...seenSourceIds],
      errorDetail
    };
  }
}
