import type { Task } from "graphile-worker";
import { and, eq, ne } from "drizzle-orm";

import {
  synthesizeProjectKnowledgeJobName,
  synthesizeProjectKnowledgePayloadSchema,
  type ProjectDimensionRecord,
  type SynthesizeProjectKnowledgePayload,
} from "@as-comms/contracts";
import {
  aiKnowledgeEntries,
  type Stage1Database,
} from "@as-comms/db";
import type {
  ProjectDimensionRepository,
  SettingsProjectsRepository,
} from "@as-comms/domain";
import {
  createNotionMarkdownPage,
  createNotionClient,
  normalizeNotionId,
  type CreateNotionMarkdownPageResult,
  type NotionClient,
} from "@as-comms/integrations";

import {
  upsertAiKnowledgeEntry,
  type UpsertAiKnowledgeEntryInput,
  type UpsertAiKnowledgeEntryResult,
} from "../notion-knowledge-sync/upsert.js";
import {
  synthesizeProjectKnowledgeOrchestrator,
  type SynthesizeProjectKnowledgeOrchestratorDependencies,
} from "./orchestrator.js";

const DEFAULT_SYNTHESIZED_PAGE_ROOT_ID = "3278a912921180598688fce711ab0509";

function readRecord(
  value: unknown,
): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function extractNotionPageId(url: string | null): string | null {
  if (url === null) {
    return null;
  }

  const match =
    /([0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/iu.exec(url);

  if (match?.[1] === undefined) {
    return null;
  }

  try {
    return normalizeNotionId(match[1]);
  } catch {
    return null;
  }
}

async function resolveNotionParentPageId(input: {
  readonly apiKey: string;
  readonly createClient: (env: { readonly NOTION_API_KEY: string }) => NotionClient;
  readonly fallbackParentPageId: string;
  readonly logger: Pick<Console, "warn">;
  readonly project: ProjectDimensionRecord;
}): Promise<string> {
  const currentPageId = extractNotionPageId(input.project.aiKnowledgeUrl ?? null);

  if (currentPageId === null) {
    return input.fallbackParentPageId;
  }

  try {
    const client = input.createClient({
      NOTION_API_KEY: input.apiKey,
    });
    const page = await client.retrievePage(currentPageId);
    const parent = readRecord(page.parent);
    const parentType = typeof parent?.type === "string" ? parent.type : null;
    const parentPageId =
      parentType === "page_id" && typeof parent?.page_id === "string"
        ? normalizeNotionId(parent.page_id)
        : null;

    return parentPageId ?? input.fallbackParentPageId;
  } catch (error) {
    input.logger.warn(
      `Falling back to default Notion parent for ${input.project.projectId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return input.fallbackParentPageId;
  }
}

export interface SynthesizeProjectKnowledgeDependencies
  extends SynthesizeProjectKnowledgeOrchestratorDependencies {
  readonly notion: {
    readonly apiKey: string;
    readonly createClient?: (env: { readonly NOTION_API_KEY: string }) => NotionClient;
    readonly createMarkdownPage?: (input: {
      readonly apiKey: string;
      readonly parentPageId: string;
      readonly title: string;
      readonly markdown: string;
    }) => Promise<CreateNotionMarkdownPageResult>;
    readonly rootPageId?: string;
  };
  readonly repositories: SynthesizeProjectKnowledgeOrchestratorDependencies["repositories"] & {
    readonly projectDimensions: Pick<
      ProjectDimensionRepository,
      "findById" | "getAiKnowledgeSources" | "setAiKnowledgeSources" | "setSynthesisMetadata"
    >;
    readonly settingsProjects: Pick<SettingsProjectsRepository, "setAiKnowledgeUrl">;
  };
  /**
   * DB connection used to write the synthesis output to ai_knowledge_entries
   * (the cache the AI Draft retriever reads). Injected separately so the job
   * tests can stub upsertEntry without standing up the full repository
   * bundle. Mirrors the pattern in notion-knowledge-sync.
   */
  readonly db: Stage1Database;
  readonly upsertEntry?: (
    db: Stage1Database,
    payload: UpsertAiKnowledgeEntryInput,
  ) => Promise<UpsertAiKnowledgeEntryResult>;
}

export type SynthesizeProjectKnowledgeResult =
  | {
      readonly ok: true;
      readonly content: string;
      readonly costUsd: number;
      readonly inputHash: string | null;
      readonly model: string;
      readonly notionPageId: string;
      readonly notionUrl: string;
      readonly projectId: string;
      readonly sourcesUsed: number;
      readonly tokensIn: number;
      readonly tokensOut: number;
    }
  | {
      readonly ok: true;
      readonly unchanged: true;
      readonly projectId: string;
      readonly sourcesChecked: number;
    }
  | {
      readonly ok: false;
      readonly code:
        | "llm_failed"
        | "no_healthy_sources"
        | "project_missing"
        | "publish_failed";
      readonly error?: unknown;
      readonly message: string;
      readonly projectId: string;
    };

export async function runSynthesizeProjectKnowledge(
  deps: SynthesizeProjectKnowledgeDependencies,
  payload: SynthesizeProjectKnowledgePayload,
): Promise<SynthesizeProjectKnowledgeResult> {
  const logger = deps.logger ?? console;
  const now = deps.now ?? (() => new Date());
  const orchestratorPayload =
    payload.skipIfHashUnchanged === undefined
      ? {
          projectId: payload.projectId,
        }
      : {
          projectId: payload.projectId,
          skipIfHashUnchanged: payload.skipIfHashUnchanged,
        };
  const orchestratorResult = await synthesizeProjectKnowledgeOrchestrator(
    deps,
    orchestratorPayload,
  );

  if (!orchestratorResult.ok) {
    return {
      ...orchestratorResult,
      projectId: payload.projectId,
    };
  }

  if ("unchanged" in orchestratorResult) {
    // Bump only ai_optimized_last_checked_at so operators can see auto-sync
    // is running. Leave ai_optimized_synthesized_at alone — content was not
    // regenerated. Re-stamp ai_optimized_input_hash with the same value
    // we just compared against (no-op write, kept for symmetry).
    await deps.repositories.projectDimensions.setSynthesisMetadata(
      payload.projectId,
      {
        lastCheckedAt: now().toISOString(),
        inputHash: orchestratorResult.inputHash,
      },
    );

    return {
      ok: true,
      unchanged: true,
      projectId: payload.projectId,
      sourcesChecked: orchestratorResult.sourcesChecked,
    };
  }

  if (!("content" in orchestratorResult)) {
    throw new Error("Expected synthesized content when auto-sync result is not unchanged.");
  }

  const {
    content,
    costUsd,
    inputHash,
    model,
    project,
    sourcesUsed,
    tokensIn,
    tokensOut,
  } = orchestratorResult;
  const createClient = deps.notion.createClient ?? createNotionClient;
  const createMarkdownPage =
    deps.notion.createMarkdownPage ?? createNotionMarkdownPage;
  const parentPageId = await resolveNotionParentPageId({
    apiKey: deps.notion.apiKey,
    createClient,
    fallbackParentPageId:
      deps.notion.rootPageId ?? DEFAULT_SYNTHESIZED_PAGE_ROOT_ID,
    logger,
    project,
  });
  const synthesizedAt = now();
  const pageTitle = `${project.projectAlias ?? project.projectName} — AI Knowledge (synthesized ${synthesizedAt.toISOString().slice(0, 16)})`;

  try {
    const notionPage = await createMarkdownPage({
      apiKey: deps.notion.apiKey,
      parentPageId,
      title: pageTitle,
      markdown: content,
    });

    await deps.repositories.settingsProjects.setAiKnowledgeUrl(
      payload.projectId,
      notionPage.url,
    );

    // Write the synthesis output directly to ai_knowledge_entries so the
    // AI Draft retriever (which reads from that cache, not from Notion)
    // picks up the new content on the very next draft. Before this landed,
    // operators had to separately enqueue notion-knowledge-sync to populate
    // the cache, and the gap between synthesis and cache-write caused
    // "Project-specific AI grounding is missing" warnings on every project
    // that had synthesized but never been sync'd (root cause confirmed in
    // prod 2026-05-29; all 4 active projects had empty cache while every
    // synthesis run looked successful).
    const upsertEntry = deps.upsertEntry ?? upsertAiKnowledgeEntry;
    const normalizedPageId = normalizeNotionId(notionPage.id);
    await upsertEntry(deps.db, {
      scope: "project",
      scopeKey: payload.projectId,
      sourceProvider: "notion",
      sourceId: normalizedPageId,
      sourceUrl: notionPage.url,
      title: pageTitle,
      content,
      metadata: {
        projectId: payload.projectId,
        trigger: "synthesize-project-knowledge",
      },
      sourceLastEditedAt: synthesizedAt,
      syncedAt: synthesizedAt,
    });

    // Each synthesis creates a fresh Notion page (immutable archive), so
    // older project-scoped Notion entries for this project are stale once
    // the new one lands. Drop them so the retriever has exactly one
    // Notion-sourced project entry per project — mirrors the cleanup in
    // notion-knowledge-sync.
    await deps.db
      .delete(aiKnowledgeEntries)
      .where(
        and(
          eq(aiKnowledgeEntries.scope, "project"),
          eq(aiKnowledgeEntries.scopeKey, payload.projectId),
          eq(aiKnowledgeEntries.sourceProvider, "notion"),
          ne(aiKnowledgeEntries.sourceId, normalizedPageId),
        ),
      );

    await deps.repositories.projectDimensions.setSynthesisMetadata(
      payload.projectId,
      {
        synthesizedAt: synthesizedAt.toISOString(),
        // Content was just regenerated, so checked-at == synthesized-at.
        lastCheckedAt: synthesizedAt.toISOString(),
        inputHash,
      },
    );

    return {
      ok: true,
      projectId: payload.projectId,
      notionPageId: notionPage.id,
      notionUrl: notionPage.url,
      content,
      inputHash,
      tokensIn,
      tokensOut,
      costUsd,
      model,
      sourcesUsed,
    };
  } catch (error) {
    logger.error(
      `Publishing synthesized AI knowledge failed for ${payload.projectId}: ${error instanceof Error ? error.message : String(error)}`,
    );

    return {
      ok: false,
      code: "publish_failed",
      error,
      message: `Publishing synthesized AI knowledge failed for ${payload.projectId}.`,
      projectId: payload.projectId,
    };
  }
}

export function createSynthesizeProjectKnowledgeTask(
  dependencies: SynthesizeProjectKnowledgeDependencies,
): Task {
  return async (payload) => {
    const result = await runSynthesizeProjectKnowledge(
      dependencies,
      synthesizeProjectKnowledgePayloadSchema.parse(payload),
    );

    if (!result.ok) {
      throw new Error(
        `[synthesize-project-knowledge] ${result.code}: ${result.message}`,
      );
    }
  };
}

export { synthesizeProjectKnowledgeJobName, synthesizeProjectKnowledgePayloadSchema };
