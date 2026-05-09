import { describe, expect, it, vi } from "vitest";

import type {
  AiKnowledgeSource,
  ProjectDimensionRecord,
} from "@as-comms/contracts";
import type { GenerateDraftResult, SourceFetchResult } from "@as-comms/integrations";

import { synthesizeProjectKnowledgeOrchestrator } from "../src/jobs/synthesize-project-knowledge/orchestrator.js";

function buildProject(): ProjectDimensionRecord {
  return {
    projectId: "project:orcas",
    projectName: "Orcas",
    projectAlias: "Orcas",
    source: "salesforce",
    isActive: true,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null,
    aiKnowledgeSources: [],
    aiOperatingContext: "",
    aiOptimizedSynthesizedAt: null,
    aiOptimizedInputHash: null,
  };
}

function buildSource(input: Partial<AiKnowledgeSource> & {
  readonly id: string;
  readonly kind: AiKnowledgeSource["kind"];
  readonly url: string;
}): AiKnowledgeSource {
  return {
    id: input.id,
    url: input.url,
    kind: input.kind,
    label: input.label ?? null,
    enabled: input.enabled ?? true,
    last_synced_at: input.last_synced_at ?? null,
    last_sync_status: input.last_sync_status ?? null,
    last_sync_error: input.last_sync_error ?? null,
    source_id: input.source_id ?? null,
    source_content_hash: input.source_content_hash ?? null,
    created_at: input.created_at ?? "2026-05-09T12:00:00.000Z",
    updated_at: input.updated_at ?? "2026-05-09T12:00:00.000Z",
  };
}

function healthyContent(content: string): SourceFetchResult {
  return {
    ok: true,
    unchanged: false,
    content,
    contentHash: `hash:${content}`,
    lastModified: null,
  };
}

function buildDraftResult(text: string): GenerateDraftResult {
  return {
    text,
    usage: {
      inputTokens: 120,
      outputTokens: 45,
    },
    stopReason: "end_turn",
    model: "claude-sonnet-4-6",
  };
}

function readPromptFromInvokeModelMock(
  invokeModel: ReturnType<typeof vi.fn>,
): string {
  const firstCall = invokeModel.mock.calls[0];
  const firstArg = firstCall?.[0] as
    | {
        readonly messages: readonly {
          readonly content: string;
        }[];
      }
    | undefined;

  return firstArg?.messages[0]?.content ?? "";
}

describe("synthesizeProjectKnowledgeOrchestrator", () => {
  it("synthesizes from healthy sources and passes all source content into the prompt", async () => {
    const project = buildProject();
    const sources = [
      buildSource({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "inline_text",
        url: "https://example.test/inline-1",
      }),
      buildSource({
        id: "22222222-2222-4222-8222-222222222222",
        kind: "notion",
        url: "https://www.notion.so/source",
      }),
      buildSource({
        id: "33333333-3333-4333-8333-333333333333",
        kind: "web_page",
        url: "https://example.test/project",
      }),
    ];
    const invokeModel = vi.fn().mockResolvedValue(buildDraftResult("# Synthesized"));
    const setAiKnowledgeSources = vi.fn().mockResolvedValue(undefined);

    const result = await synthesizeProjectKnowledgeOrchestrator(
      {
        repositories: {
          projectDimensions: {
            findById: vi.fn().mockResolvedValue(project),
            getAiKnowledgeSources: vi.fn().mockResolvedValue(sources),
            setAiKnowledgeSources,
          },
        },
        fetchers: {
          inline_text: { fetch: vi.fn().mockResolvedValue(healthyContent("Inline operator context")) },
          notion: { fetch: vi.fn().mockResolvedValue(healthyContent("Notion source content")) },
          web_page: { fetch: vi.fn().mockResolvedValue(healthyContent("Web source content")) },
        },
        invokeModel,
      },
      {
        projectId: project.projectId,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      content: "# Synthesized",
      tokensIn: 120,
      tokensOut: 45,
      model: "claude-sonnet-4-6",
      sourcesUsed: 3,
    });
    expect(invokeModel).toHaveBeenCalledTimes(1);
    const prompt = readPromptFromInvokeModelMock(invokeModel);
    expect(prompt).toContain("Inline operator context");
    expect(prompt).toContain("Notion source content");
    expect(prompt).toContain("Web source content");
    expect(setAiKnowledgeSources).toHaveBeenCalledTimes(1);
  });

  it("persists broken sources but only sends healthy sources to the model", async () => {
    const project = buildProject();
    const sources = [
      buildSource({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "inline_text",
        url: "https://example.test/inline-1",
      }),
      buildSource({
        id: "22222222-2222-4222-8222-222222222222",
        kind: "notion",
        url: "https://www.notion.so/source",
      }),
      buildSource({
        id: "33333333-3333-4333-8333-333333333333",
        kind: "web_page",
        url: "https://example.test/project",
      }),
    ];
    const setAiKnowledgeSources = vi.fn().mockResolvedValue(undefined);
    const invokeModel = vi.fn().mockResolvedValue(buildDraftResult("# Synthesized"));

    await synthesizeProjectKnowledgeOrchestrator(
      {
        repositories: {
          projectDimensions: {
            findById: vi.fn().mockResolvedValue(project),
            getAiKnowledgeSources: vi.fn().mockResolvedValue(sources),
            setAiKnowledgeSources,
          },
        },
        fetchers: {
          inline_text: { fetch: vi.fn().mockResolvedValue(healthyContent("Inline operator context")) },
          notion: { fetch: vi.fn().mockResolvedValue(healthyContent("Notion source content")) },
          web_page: {
            fetch: vi.fn().mockResolvedValue({
              ok: false,
              status: "broken",
              error: "HTTP 500",
            } satisfies SourceFetchResult),
          },
        },
        invokeModel,
      },
      {
        projectId: project.projectId,
      },
    );

    const persistedSources = setAiKnowledgeSources.mock.calls[0]?.[1] as
      | readonly AiKnowledgeSource[]
      | undefined;
    expect(
      persistedSources?.find(
        (source) => source.id === "33333333-3333-4333-8333-333333333333",
      ),
    ).toMatchObject({
      last_sync_status: "broken",
      last_sync_error: "HTTP 500",
      source_content_hash: null,
    });
    const prompt = readPromptFromInvokeModelMock(invokeModel);
    expect(prompt).toContain("Inline operator context");
    expect(prompt).toContain("Notion source content");
    expect(prompt).not.toContain("HTTP 500");
  });

  it("returns no_healthy_sources when the source list is empty or all sources fail", async () => {
    const project = buildProject();
    const emptyResult = await synthesizeProjectKnowledgeOrchestrator(
      {
        repositories: {
          projectDimensions: {
            findById: vi.fn().mockResolvedValue(project),
            getAiKnowledgeSources: vi.fn().mockResolvedValue([]),
            setAiKnowledgeSources: vi.fn().mockResolvedValue(undefined),
          },
        },
        fetchers: {
          inline_text: { fetch: vi.fn() },
          notion: { fetch: vi.fn() },
          web_page: { fetch: vi.fn() },
        },
        invokeModel: vi.fn(),
      },
      {
        projectId: project.projectId,
      },
    );

    expect(emptyResult).toMatchObject({
      ok: false,
      code: "no_healthy_sources",
    });

    const brokenResult = await synthesizeProjectKnowledgeOrchestrator(
      {
        repositories: {
          projectDimensions: {
            findById: vi.fn().mockResolvedValue(project),
            getAiKnowledgeSources: vi.fn().mockResolvedValue([
              buildSource({
                id: "44444444-4444-4444-8444-444444444444",
                kind: "web_page",
                url: "https://example.test/project",
              }),
            ]),
            setAiKnowledgeSources: vi.fn().mockResolvedValue(undefined),
          },
        },
        fetchers: {
          inline_text: { fetch: vi.fn() },
          notion: { fetch: vi.fn() },
          web_page: {
            fetch: vi.fn().mockResolvedValue({
              ok: false,
              status: "broken",
              error: "HTTP 500",
            } satisfies SourceFetchResult),
          },
        },
        invokeModel: vi.fn(),
      },
      {
        projectId: project.projectId,
      },
    );

    expect(brokenResult).toMatchObject({
      ok: false,
      code: "no_healthy_sources",
    });
  });

  it("returns llm_failed and still persists source state when the model errors", async () => {
    const project = buildProject();
    const setAiKnowledgeSources = vi.fn().mockResolvedValue(undefined);

    const result = await synthesizeProjectKnowledgeOrchestrator(
      {
        repositories: {
          projectDimensions: {
            findById: vi.fn().mockResolvedValue(project),
            getAiKnowledgeSources: vi.fn().mockResolvedValue([
              buildSource({
                id: "55555555-5555-4555-8555-555555555555",
                kind: "inline_text",
                url: "https://example.test/inline-2",
              }),
            ]),
            setAiKnowledgeSources,
          },
        },
        fetchers: {
          inline_text: { fetch: vi.fn().mockResolvedValue(healthyContent("Inline operator context")) },
          notion: { fetch: vi.fn() },
          web_page: { fetch: vi.fn() },
        },
        invokeModel: vi.fn().mockRejectedValue(new Error("Anthropic down")),
      },
      {
        projectId: project.projectId,
      },
    );

    expect(result).toMatchObject({
      ok: false,
      code: "llm_failed",
    });
    expect(setAiKnowledgeSources).toHaveBeenCalledTimes(1);
  });

  it("skips disabled sources", async () => {
    const project = buildProject();
    const disabledSource = buildSource({
      id: "66666666-6666-4666-8666-666666666666",
      kind: "web_page",
      url: "https://example.test/project",
      enabled: false,
    });
    const webFetch = vi.fn();

    await synthesizeProjectKnowledgeOrchestrator(
      {
        repositories: {
          projectDimensions: {
            findById: vi.fn().mockResolvedValue(project),
            getAiKnowledgeSources: vi.fn().mockResolvedValue([
              disabledSource,
              buildSource({
                id: "77777777-7777-4777-8777-777777777777",
                kind: "inline_text",
                url: "https://example.test/inline-3",
              }),
            ]),
            setAiKnowledgeSources: vi.fn().mockResolvedValue(undefined),
          },
        },
        fetchers: {
          inline_text: { fetch: vi.fn().mockResolvedValue(healthyContent("Inline operator context")) },
          notion: { fetch: vi.fn() },
          web_page: { fetch: webFetch },
        },
        invokeModel: vi.fn().mockResolvedValue(buildDraftResult("# Synthesized")),
      },
      {
        projectId: project.projectId,
      },
    );

    expect(webFetch).not.toHaveBeenCalled();
  });
});
