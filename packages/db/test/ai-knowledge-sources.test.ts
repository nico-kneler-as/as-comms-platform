import { readdir, readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { ZodError } from "zod";

import { aiKnowledgeSourcesSchema, type AiKnowledgeSource } from "@as-comms/contracts";

import {
  addSource,
  aiKnowledgeEntries,
  inputHashFromSources,
  markSourceSyncResult,
  parseSourceUrl,
  projectDimensions,
  removeSource,
  setSourceEnabled,
  type Stage1Database,
  updateSource,
} from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

function buildSource(input: {
  readonly id?: string;
  readonly url?: string;
  readonly kind?: AiKnowledgeSource["kind"];
  readonly label?: string | null;
  readonly enabled?: boolean;
  readonly last_synced_at?: string | null;
  readonly last_sync_status?: AiKnowledgeSource["last_sync_status"];
  readonly last_sync_error?: string | null;
  readonly source_id?: string | null;
  readonly source_content_hash?: string | null;
  readonly created_at?: string;
  readonly updated_at?: string;
} = {}): AiKnowledgeSource {
  return aiKnowledgeSourcesSchema.element.parse({
    id: input.id ?? "4f84c4cb-7ee4-4df4-b0c6-385a3b6d3d70",
    url:
      input.url ?? "https://www.notion.so/3278a9129211804baa72c76a86d084d0",
    kind: input.kind ?? "notion",
    label: input.label ?? "Training page",
    enabled: input.enabled ?? true,
    last_synced_at: input.last_synced_at ?? null,
    last_sync_status: input.last_sync_status ?? null,
    last_sync_error: input.last_sync_error ?? null,
    source_id: input.source_id ?? "3278a9129211804baa72c76a86d084d0",
    source_content_hash: input.source_content_hash ?? null,
    created_at: input.created_at ?? "2026-05-01T12:00:00.000Z",
    updated_at: input.updated_at ?? "2026-05-01T12:00:00.000Z",
  });
}

async function applyMigrationsThrough(
  client: PGlite,
  migrationName: string,
): Promise<void> {
  const drizzleDirectoryUrl = new URL("../src/../drizzle/", import.meta.url);
  const migrationFiles = (await readdir(drizzleDirectoryUrl))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  for (const migrationFile of migrationFiles) {
    const migrationSql = await readFile(
      new URL(migrationFile, drizzleDirectoryUrl),
      "utf8",
    );
    await client.exec(migrationSql);

    if (migrationFile === migrationName) {
      return;
    }
  }

  throw new Error(`Migration ${migrationName} was not found.`);
}

async function applySingleMigration(
  client: PGlite,
  migrationName: string,
): Promise<void> {
  const drizzleDirectoryUrl = new URL("../src/../drizzle/", import.meta.url);
  const migrationSql = await readFile(
    new URL(migrationName, drizzleDirectoryUrl),
    "utf8",
  );

  await client.exec(migrationSql);
}

describe("AI knowledge source registry helpers", () => {
  it("parses notion URLs and stable web URLs", () => {
    const expectedSourceId = "3278a9129211804baa72c76a86d084d0";
    const notionUrls = [
      "https://www.notion.so/Project-Training-3278a9129211804baa72c76a86d084d0",
      "https://notion.so/Project-Training-3278a912-9211-804b-aa72-c76a86d084d0",
      "https://workspace.notion.so/3278a9129211804baa72c76a86d084d0?source=copy_link",
      "https://www.notion.so/3278a9129211804baa72c76a86d084d0",
    ];

    for (const notionUrl of notionUrls) {
      expect(parseSourceUrl(notionUrl)).toEqual({
        kind: "notion",
        source_id: expectedSourceId,
        normalized_url: `https://www.notion.so/${expectedSourceId}`,
      });
    }

    const firstWeb = parseSourceUrl(
      "https://www.adventurescientists.org/project/whitebark-pine",
    );
    const secondWeb = parseSourceUrl(
      "https://www.adventurescientists.org/project/whitebark-pine",
    );

    expect(firstWeb.kind).toBe("web_page");
    expect(firstWeb.source_id).toBe(secondWeb.source_id);
    expect(firstWeb.normalized_url).toBe(
      "https://www.adventurescientists.org/project/whitebark-pine",
    );
  });

  it("rejects invalid source URLs with a typed validation error", () => {
    expect(() => parseSourceUrl("")).toThrowError(/required/i);
    expect(() => parseSourceUrl("not-a-url")).toThrowError(/invalid/i);
    expect(() => parseSourceUrl("ftp://example.com")).toThrowError(/scheme/i);
    expect(() => parseSourceUrl("mailto:test@example.com")).toThrowError(
      /scheme/i,
    );
  });

  it("adds, updates, removes, toggles, and hashes sources immutably", () => {
    const original = [
      buildSource(),
      buildSource({
        id: "0a749d74-0a10-4dd1-b787-a3b74ef296b3",
        url: "https://www.adventurescientists.org/project/whitebark-pine",
        kind: "web_page",
        source_id:
          "67999feeb13b36758c2f4665755cb1e9bc02ecc57b544f50b217df2e3d898ca6",
        source_content_hash: "hash:web",
      }),
    ] as const;

    const appended = addSource([], {
      url: "https://www.notion.so/Project-Training-3278a9129211804baa72c76a86d084d0",
      label: "Training page",
      now: "2026-05-02T09:00:00.000Z",
    });
    expect(appended[0]).toBeDefined();
    expect(appended).toHaveLength(1);

    expect(() =>
      addSource(original, {
        url: "https://notion.so/Project-Training-3278a912-9211-804b-aa72-c76a86d084d0",
      }),
    ).toThrowError(/already exists/i);

    const updated = updateSource(original, original[0].id, {
      label: "Updated label",
    });
    const [updatedFirst, updatedSecond] = updated;
    expect(updatedFirst?.label).toBe("Updated label");
    expect(updatedFirst?.updated_at).not.toBe(original[0].updated_at);
    expect(updatedSecond).toEqual(original[1]);

    const toggled = setSourceEnabled(original, original[1].id, false);
    const [, toggledSecond] = toggled;
    expect(toggledSecond?.enabled).toBe(false);
    expect(toggledSecond?.url).toBe(original[1].url);

    const synced = markSourceSyncResult(original, original[0].id, {
      last_synced_at: "2026-05-03T10:00:00.000Z",
      last_sync_status: "healthy",
      last_sync_error: null,
      source_content_hash: "hash:notion",
    });
    expect(synced[0]).toMatchObject({
      last_synced_at: "2026-05-03T10:00:00.000Z",
      last_sync_status: "healthy",
      last_sync_error: null,
      source_content_hash: "hash:notion",
    });

    const removed = removeSource(original, original[0].id);
    expect(removed).toEqual([original[1]]);

    const firstHash = inputHashFromSources([
      buildSource({ source_content_hash: "hash:notion" }),
      buildSource({
        id: "0a749d74-0a10-4dd1-b787-a3b74ef296b3",
        url: "https://www.adventurescientists.org/project/whitebark-pine",
        kind: "web_page",
        source_id: "hash:web-page",
        source_content_hash: "hash:web",
      }),
      buildSource({
        id: "f612ec45-3a7f-4d87-b013-941ab8086e75",
        enabled: false,
        source_content_hash: "hash:disabled",
      }),
      buildSource({
        id: "44f57c08-f7fe-4e05-baa1-8ecb5abfa568",
        source_content_hash: null,
      }),
    ]);
    const secondHash = inputHashFromSources([
      buildSource({ source_content_hash: "hash:notion" }),
      buildSource({
        id: "0a749d74-0a10-4dd1-b787-a3b74ef296b3",
        url: "https://www.adventurescientists.org/project/whitebark-pine",
        kind: "web_page",
        source_id: "hash:web-page",
        source_content_hash: "hash:web",
      }),
      buildSource({
        id: "f612ec45-3a7f-4d87-b013-941ab8086e75",
        enabled: false,
        source_content_hash: "hash:disabled",
      }),
      buildSource({
        id: "44f57c08-f7fe-4e05-baa1-8ecb5abfa568",
        source_content_hash: null,
      }),
    ]);

    expect(firstHash).toBe(secondHash);
    expect(firstHash).not.toBeNull();
    expect(inputHashFromSources([])).toBeNull();
  });
});

describe("AI knowledge source registry repository methods", () => {
  it("round-trips JSONB sources and metadata through project_dimensions", async () => {
    const context = await createTestStage1Context();

    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project:registry",
        projectName: "Registry Project",
        source: "salesforce",
      });

      const sources = [
        buildSource({
          source_content_hash: "hash:notion",
          last_synced_at: "2026-05-01T13:00:00.000Z",
          last_sync_status: "healthy",
        }),
      ];

      await context.repositories.projectDimensions.setAiKnowledgeSources(
        "project:registry",
        sources,
      );

      await expect(
        context.repositories.projectDimensions.getAiKnowledgeSources(
          "project:registry",
        ),
      ).resolves.toEqual(sources);

      await context.repositories.projectDimensions.updateOperatingContext(
        "project:registry",
        "Crew brief refreshed today.",
      );
      await context.repositories.projectDimensions.setAiAutoSyncSchedule(
        "project:registry",
        "weekly",
      );
      await context.repositories.projectDimensions.setSynthesisMetadata(
        "project:registry",
        {
          synthesizedAt: "2026-05-04T08:30:00.000Z",
          inputHash: "hash:input",
        },
      );

      const [row] = await context.db
        .select()
        .from(projectDimensions)
        .where(eq(projectDimensions.projectId, "project:registry"));

      expect(row?.aiOperatingContext).toBe("Crew brief refreshed today.");
      expect(row?.aiAutoSyncSchedule).toBe("weekly");
      expect(row?.aiOptimizedInputHash).toBe("hash:input");
      expect(row?.aiOptimizedSynthesizedAt?.toISOString()).toBe(
        "2026-05-04T08:30:00.000Z",
      );

      await context.repositories.projectDimensions.setSynthesisMetadata(
        "project:registry",
        {
          synthesizedAt: null,
          inputHash: null,
        },
      );

      const [clearedRow] = await context.db
        .select()
        .from(projectDimensions)
        .where(eq(projectDimensions.projectId, "project:registry"));
      expect(clearedRow?.aiOptimizedSynthesizedAt).toBeNull();
      expect(clearedRow?.aiOptimizedInputHash).toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("rejects malformed source arrays via zod", async () => {
    const context = await createTestStage1Context();

    try {
      await context.repositories.projectDimensions.upsert({
        projectId: "project:invalid",
        projectName: "Invalid Project",
        source: "salesforce",
      });

      await expect(
        context.repositories.projectDimensions.setAiKnowledgeSources(
          "project:invalid",
          [
            {
              id: "not-a-uuid",
              url: "not-a-url",
            },
          ] as unknown as readonly AiKnowledgeSource[],
        ),
      ).rejects.toBeInstanceOf(ZodError);
    } finally {
      await context.dispose();
    }
  });
});

describe("0055_ai_knowledge_auto_sync_schedule migration", () => {
  it("defaults to never and rejects invalid schedule values", async () => {
    const client = new PGlite();

    try {
      await applyMigrationsThrough(
        client,
        "0054_ai_knowledge_source_registry.sql",
      );
      await applySingleMigration(
        client,
        "0055_ai_knowledge_auto_sync_schedule.sql",
      );
      // Apply later migrations so the table schema matches the Drizzle table
      // definition (which includes connected_to_project_id from 0056,
      // postmark_sender_status from 0057, and ai_optimized_last_checked_at
      // from 0063).
      await applySingleMigration(
        client,
        "0056_project_dimensions_connected_to.sql",
      );
      await applySingleMigration(
        client,
        "0057_stage5_campaigns_schema.sql",
      );
      await applySingleMigration(
        client,
        "0063_ai_optimized_last_checked_at.sql",
      );

      const db = drizzle(client) as Stage1Database;
      await client.exec(`
        insert into "project_dimensions" (
          "project_id",
          "project_name",
          "source"
        ) values (
          'project:auto-sync',
          'Auto Sync Project',
          'salesforce'
        );
      `);

      const [project] = await db
        .select()
        .from(projectDimensions)
        .where(eq(projectDimensions.projectId, "project:auto-sync"));

      expect(project?.aiAutoSyncSchedule).toBe("never");

      await expect(
        client.exec(`
          update "project_dimensions"
          set "ai_auto_sync_schedule" = 'monthly'
          where "project_id" = 'project:auto-sync';
        `),
      ).rejects.toThrow(/ai_auto_sync_schedule/i);
    } finally {
      await client.close();
    }
  });
});

describe("0054_ai_knowledge_source_registry migration", () => {
  it("backfills active project URLs into ai_knowledge_sources without touching legacy fields", async () => {
    const client = new PGlite();

    try {
      await applyMigrationsThrough(client, "0053_mailchimp_campaign_tail_state.sql");
      await client.exec(`
        insert into "project_dimensions" (
          "project_id",
          "project_name",
          "project_alias",
          "is_active",
          "ai_knowledge_url",
          "ai_knowledge_synced_at",
          "source"
        ) values
          (
            'project:alpha',
            'Project Alpha',
            'Alpha',
            true,
            'https://www.notion.so/Project-Training-3278a9129211804baa72c76a86d084d0',
            '2026-05-01T12:00:00.000Z',
            'salesforce'
          ),
          (
            'project:beta',
            'Project Beta',
            'Beta',
            false,
            null,
            null,
            'salesforce'
          );

        insert into "ai_knowledge_entries" (
          "id",
          "scope",
          "scope_key",
          "source_provider",
          "source_id",
          "source_url",
          "title",
          "content",
          "content_hash",
          "metadata_json",
          "source_last_edited_at",
          "synced_at"
        ) values (
          'ai_knowledge:notion:project-alpha',
          'project',
          'project:alpha',
          'notion',
          '3278a912-9211-804b-aa72-c76a86d084d0',
          'https://www.notion.so/Project-Training-3278a9129211804baa72c76a86d084d0',
          null,
          'Cached notion markdown',
          'hash:legacy-cache',
          '{}'::jsonb,
          '2026-05-01T11:59:00.000Z',
          '2026-05-01T12:00:00.000Z'
        );
      `);

      await applySingleMigration(client, "0054_ai_knowledge_source_registry.sql");
      // Apply later migrations so the table schema matches the Drizzle table
      // definition (which includes columns added after 0054, e.g.,
      // ai_auto_sync_schedule from 0055, connected_to_project_id from 0056,
      // postmark_sender_status from 0057, ai_optimized_last_checked_at
      // from 0063).
      await applySingleMigration(
        client,
        "0055_ai_knowledge_auto_sync_schedule.sql",
      );
      await applySingleMigration(
        client,
        "0056_project_dimensions_connected_to.sql",
      );
      await applySingleMigration(
        client,
        "0057_stage5_campaigns_schema.sql",
      );
      await applySingleMigration(
        client,
        "0063_ai_optimized_last_checked_at.sql",
      );

      const db = drizzle(client) as Stage1Database;
      const [projectWithSource] = await db
        .select()
        .from(projectDimensions)
        .where(eq(projectDimensions.projectId, "project:alpha"));
      const [projectWithoutSource] = await db
        .select()
        .from(projectDimensions)
        .where(eq(projectDimensions.projectId, "project:beta"));
      const [legacyEntry] = await db
        .select()
        .from(aiKnowledgeEntries)
        .where(
          and(
            eq(aiKnowledgeEntries.scope, "project"),
            eq(aiKnowledgeEntries.scopeKey, "project:alpha"),
          ),
        );

      const sources = aiKnowledgeSourcesSchema.parse(
        projectWithSource?.aiKnowledgeSources ?? [],
      );
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        url: "https://www.notion.so/Project-Training-3278a9129211804baa72c76a86d084d0",
        kind: "notion",
        source_id: "3278a9129211804baa72c76a86d084d0",
        last_synced_at: "2026-05-01T12:00:00.000Z",
        last_sync_status: "healthy",
        source_content_hash: "hash:legacy-cache",
      });
      expect(projectWithoutSource?.aiKnowledgeSources).toEqual([]);
      expect(projectWithSource?.aiKnowledgeUrl).toBe(
        "https://www.notion.so/Project-Training-3278a9129211804baa72c76a86d084d0",
      );
      expect(legacyEntry?.contentHash).toBe("hash:legacy-cache");
    } finally {
      await client.close();
    }
  });
});
