#!/usr/bin/env tsx
/**
 * migrate-notion-child-dbs-to-project-knowledge
 *
 * Usage:
 *   pnpm --filter @as-comms/worker ops:migrate-notion-child-dbs-to-project-knowledge -- --dry-run --slug-map ./slug-map.json
 */
import process from "node:process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundleFromConnection
} from "@as-comms/db";
import {
  createNotionClient,
  queryDatabase,
  type DatabaseRow,
  type NotionClient
} from "@as-comms/integrations";
import type { ProjectKnowledgeEntryRecord } from "@as-comms/contracts";
import type { Stage1RepositoryBundle } from "@as-comms/domain";

type KnowledgeKind = ProjectKnowledgeEntryRecord["kind"];

interface MigrationConfig {
  readonly apiKey: string;
  readonly projectTrainingDatabaseId: string;
  readonly databaseUrl: string;
  readonly slugMapPath: string | null;
  readonly dryRun: boolean;
}

interface ChildDatabaseRef {
  readonly id: string;
  readonly title: string;
  readonly kind: KnowledgeKind;
}

interface MigrationResult {
  readonly scannedChildDatabases: number;
  readonly candidateCount: number;
  readonly insertedCount: number;
  readonly skippedCount: number;
  readonly slugMissCount: number;
}

function readRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const workerDatabaseUrl = env.WORKER_DATABASE_URL?.trim();
  return workerDatabaseUrl && workerDatabaseUrl.length > 0
    ? workerDatabaseUrl
    : readRequiredEnv(env, "DATABASE_URL");
}

function readConfig(argv: readonly string[], env: NodeJS.ProcessEnv): MigrationConfig {
  const parsed = parseArgs({
    args: [...argv],
    options: {
      "dry-run": {
        type: "boolean",
        default: false
      },
      "slug-map": {
        type: "string"
      }
    },
    strict: true,
    allowPositionals: false
  });

  return {
    apiKey: readRequiredEnv(env, "NOTION_API_KEY"),
    projectTrainingDatabaseId: readRequiredEnv(
      env,
      "NOTION_PROJECT_TRAINING_DATABASE_ID"
    ),
    databaseUrl: readConnectionString(env),
    slugMapPath: parsed.values["slug-map"] ?? null,
    dryRun: parsed.values["dry-run"]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function richTextPlain(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const text = value
    .map((part) =>
      isRecord(part) && typeof part.plain_text === "string" ? part.plain_text : ""
    )
    .join("")
    .trim();

  return text.length === 0 ? null : text;
}

function propertyText(
  properties: Record<string, unknown>,
  names: readonly string[]
): string | null {
  for (const name of names) {
    const property = properties[name];
    if (!isRecord(property) || typeof property.type !== "string") {
      continue;
    }

    const value =
      property.type === "title"
        ? richTextPlain(property.title)
        : property.type === "rich_text"
          ? richTextPlain(property.rich_text)
          : property.type === "select" && isRecord(property.select)
            ? typeof property.select.name === "string"
              ? property.select.name
              : null
            : property.type === "url" && typeof property.url === "string"
              ? property.url
              : property.type === "date" && isRecord(property.date)
                ? typeof property.date.start === "string"
                  ? property.date.start
                  : null
                : null;

    if (value !== null && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function propertyCheckbox(
  properties: Record<string, unknown>,
  names: readonly string[]
): boolean {
  for (const name of names) {
    const property = properties[name];
    if (isRecord(property) && property.type === "checkbox") {
      return property.checkbox === true;
    }
  }

  return true;
}

async function readSlugMap(path: string | null): Promise<ReadonlyMap<string, string>> {
  if (path === null) {
    return new Map();
  }

  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("--slug-map must point to a JSON object.");
  }

  return new Map(
    Object.entries(parsed).flatMap(([slug, projectId]) =>
      typeof projectId === "string" && projectId.trim().length > 0
        ? [[slug, projectId.trim()] as const]
        : []
    )
  );
}

function classifyChildDatabase(title: string, projectName: string): KnowledgeKind | null {
  const normalizedTitle = title.toLowerCase();
  const normalizedProject = projectName.toLowerCase();
  if (!normalizedTitle.startsWith(normalizedProject)) {
    return null;
  }

  if (normalizedTitle.endsWith("canonical replies")) {
    return "canonical_reply";
  }
  if (normalizedTitle.endsWith("approved snippets")) {
    return "snippet";
  }
  if (normalizedTitle.endsWith("support patterns")) {
    return "pattern";
  }

  return null;
}

async function listChildDatabases(input: {
  readonly client: NotionClient;
  readonly pageId: string;
  readonly projectName: string;
}): Promise<readonly ChildDatabaseRef[]> {
  const refs: ChildDatabaseRef[] = [];
  let cursor: string | undefined;

  for (;;) {
    const response = await input.client.listBlockChildren({
      blockId: input.pageId,
      ...(cursor === undefined ? {} : { startCursor: cursor })
    });
    const results = Array.isArray(response.results) ? response.results : [];

    for (const block of results) {
      if (!isRecord(block) || block.type !== "child_database") {
        continue;
      }
      const child = block.child_database;
      const title =
        isRecord(child) && typeof child.title === "string" ? child.title : null;
      const id = typeof block.id === "string" ? block.id : null;
      if (title === null || id === null) {
        continue;
      }

      const kind = classifyChildDatabase(title, input.projectName);
      if (kind !== null) {
        refs.push({
          id,
          title,
          kind
        });
      }
    }

    if (response.has_more !== true || typeof response.next_cursor !== "string") {
      return refs;
    }
    cursor = response.next_cursor;
  }
}

function buildMetadata(row: DatabaseRow, kind: KnowledgeKind): Record<string, unknown> {
  if (kind === "canonical_reply") {
    return {
      sourceBasis: propertyText(row.properties, ["Source Basis"]),
      whyThisWorks: propertyText(row.properties, ["Why This Works"]),
      channel: propertyText(row.properties, ["Channel"]),
      lastReviewedNotion:
        propertyText(row.properties, ["Last Reviewed", "Last reviewed"]) ??
        row.lastEditedTime
    };
  }

  if (kind === "pattern") {
    return {
      useSources: propertyText(row.properties, ["Use Sources", "Use sources"]),
      avoidSaying: propertyText(row.properties, ["Avoid Saying", "Avoid saying"]),
      lastReviewedNotion: row.lastEditedTime
    };
  }

  return {
    sourceBasis: propertyText(row.properties, ["Source Basis"]),
    channel: propertyText(row.properties, ["Channel"]),
    lastReviewedNotion: row.lastEditedTime
  };
}

function mapChildRow(input: {
  readonly row: DatabaseRow;
  readonly projectId: string;
  readonly kind: KnowledgeKind;
  readonly nowIso: string;
}): ProjectKnowledgeEntryRecord | null {
  const questionSummary =
    input.kind === "canonical_reply"
      ? propertyText(input.row.properties, ["Question Summary", "Name"])
      : propertyText(input.row.properties, ["Name", "Question Summary"]);
  if (questionSummary === null) {
    return null;
  }

  const maskedExample =
    input.kind === "pattern"
      ? null
      : propertyText(input.row.properties, [
          "Masked Example",
          "Snippet content",
          "Snippet Content",
          "Content"
        ]);

  return {
    id: `project_knowledge:notion:${input.row.id}`,
    projectId: input.projectId,
    kind: input.kind,
    issueType: propertyText(input.row.properties, ["Issue Type"]),
    volunteerStage: propertyText(input.row.properties, ["Volunteer Stage"]),
    questionSummary,
    replyStrategy:
      input.kind === "snippet"
        ? null
        : propertyText(input.row.properties, [
            "Reply Strategy",
            "Recommended Pattern"
          ]),
    maskedExample,
    sourceKind: "hand_authored",
    approvedForAi: propertyCheckbox(input.row.properties, ["Approved for AI"]),
    sourceEventId: null,
    metadataJson: buildMetadata(input.row, input.kind),
    lastReviewedAt: null,
    createdAt: input.nowIso,
    updatedAt: input.nowIso
  };
}

function resolveProjectId(input: {
  readonly row: DatabaseRow;
  readonly slugMap: ReadonlyMap<string, string>;
  readonly knownProjectIds: ReadonlySet<string>;
  readonly logger: Pick<Console, "warn">;
}): string | null {
  const rawProjectId = propertyText(input.row.properties, ["Project ID"]);
  if (rawProjectId === null) {
    input.logger.warn(`Skipping ${input.row.id}; Project ID is empty.`);
    return null;
  }

  if (input.knownProjectIds.has(rawProjectId)) {
    return rawProjectId;
  }

  const mapped = input.slugMap.get(rawProjectId);
  if (mapped !== undefined && input.knownProjectIds.has(mapped)) {
    return mapped;
  }

  input.logger.warn(
    `Skipping ${input.row.id}; Project ID ${rawProjectId} is not in --slug-map.`
  );
  return null;
}

export async function migrateNotionChildDbsToProjectKnowledge(input: {
  readonly client: NotionClient;
  readonly repositories: Stage1RepositoryBundle;
  readonly projectTrainingDatabaseId: string;
  readonly slugMap: ReadonlyMap<string, string>;
  readonly dryRun: boolean;
  readonly logger?: Pick<Console, "log" | "warn">;
  readonly now?: () => Date;
}): Promise<MigrationResult> {
  const logger = input.logger ?? console;
  const nowIso = (input.now ?? (() => new Date()))().toISOString();
  const projects = await input.repositories.projectDimensions.listAll();
  const knownProjectIds = new Set(projects.map((project) => project.projectId));
  const projectNameById = new Map(
    projects.map((project) => [project.projectId, project.projectName] as const)
  );
  const existingSummariesByProject = new Map<string, Set<string>>();
  let scannedChildDatabases = 0;
  let candidateCount = 0;
  let insertedCount = 0;
  let skippedCount = 0;
  let slugMissCount = 0;

  for await (const projectRow of queryDatabase(
    input.client,
    input.projectTrainingDatabaseId
  )) {
    const projectId = resolveProjectId({
      row: projectRow,
      slugMap: input.slugMap,
      knownProjectIds,
      logger
    });
    if (projectId === null) {
      slugMissCount += 1;
      continue;
    }

    const projectName =
      propertyText(projectRow.properties, ["Name"]) ??
      projectNameById.get(projectId) ??
      projectId;
    const childDatabases = await listChildDatabases({
      client: input.client,
      pageId: projectRow.id,
      projectName
    });

    for (const childDatabase of childDatabases) {
      scannedChildDatabases += 1;
      const existingSummaries =
        existingSummariesByProject.get(projectId) ??
        new Set(
          (
            await input.repositories.projectKnowledge.list({
              projectId
            })
          ).map((entry) => entry.questionSummary.toLowerCase())
        );
      existingSummariesByProject.set(projectId, existingSummaries);

      for await (const childRow of queryDatabase(input.client, childDatabase.id)) {
        const entry = mapChildRow({
          row: childRow,
          projectId,
          kind: childDatabase.kind,
          nowIso
        });
        if (entry === null) {
          skippedCount += 1;
          continue;
        }

        const dedupeKey = entry.questionSummary.toLowerCase();
        if (existingSummaries.has(dedupeKey)) {
          skippedCount += 1;
          continue;
        }

        candidateCount += 1;
        logger.log(
          `${input.dryRun ? "Would insert" : "Inserting"} ${entry.kind}: ${entry.questionSummary}`
        );
        if (!input.dryRun) {
          await input.repositories.projectKnowledge.upsert(entry);
          existingSummaries.add(dedupeKey);
          insertedCount += 1;
        }
      }
    }
  }

  return {
    scannedChildDatabases,
    candidateCount,
    insertedCount,
    skippedCount,
    slugMissCount
  };
}

async function main(): Promise<void> {
  const config = readConfig(process.argv.slice(2), process.env);
  const slugMap = await readSlugMap(config.slugMapPath);
  const connection = createDatabaseConnection({
    connectionString: config.databaseUrl
  });

  try {
    const result = await migrateNotionChildDbsToProjectKnowledge({
      client: createNotionClient({
        NOTION_API_KEY: config.apiKey
      }),
      repositories: createStage1RepositoryBundleFromConnection(connection),
      projectTrainingDatabaseId: config.projectTrainingDatabaseId,
      slugMap,
      dryRun: config.dryRun
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeDatabaseConnection(connection);
  }
}

const entrypointPath = process.argv[1];
if (
  entrypointPath !== undefined &&
  import.meta.url === pathToFileURL(entrypointPath).href
) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
