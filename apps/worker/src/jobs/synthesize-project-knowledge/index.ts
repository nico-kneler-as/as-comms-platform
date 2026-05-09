import type { Task } from "graphile-worker";

import {
  synthesizeProjectKnowledgeJobName,
  synthesizeProjectKnowledgePayloadSchema,
  type ProjectDimensionRecord,
  type SynthesizeProjectKnowledgePayload,
} from "@as-comms/contracts";
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
    await deps.repositories.projectDimensions.setSynthesisMetadata(
      payload.projectId,
      {
        synthesizedAt: synthesizedAt.toISOString(),
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
