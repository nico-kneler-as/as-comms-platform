import { describe, expect, it, vi } from "vitest";

import type {
  AiKnowledgeSource,
  ProjectDimensionRecord,
  ProjectKnowledgeEntryRecord,
} from "@as-comms/contracts";
import { inputHashFromSources } from "@as-comms/db";
import type { GenerateDraftResult, SourceFetchResult } from "@as-comms/integrations";

import { synthesizeProjectKnowledgeOrchestrator } from "../src/jobs/synthesize-project-knowledge/orchestrator.js";

function buildEmptyProjectKnowledge() {
  return {
    list: vi.fn().mockResolvedValue([]),
  };
}

function buildApprovedReply(input: {
  readonly id: string;
  readonly maskedExample: string;
  readonly createdAt: string;
  readonly kind?: ProjectKnowledgeEntryRecord["kind"];
}): ProjectKnowledgeEntryRecord {
  return {
    id: input.id,
    projectId: "project:orcas",
    kind: input.kind ?? "canonical_reply",
    issueType: null,
    volunteerStage: null,
    questionSummary: `Question for ${input.id}`,
    replyStrategy: null,
    maskedExample: input.maskedExample,
    sourceKind: "captured_from_send",
    approvedForAi: true,
    sourceEventId: null,
    metadataJson: {},
    lastReviewedAt: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

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
    aiAutoSyncSchedule: "never",
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
          projectKnowledge: buildEmptyProjectKnowledge(),
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
          projectKnowledge: buildEmptyProjectKnowledge(),
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
          projectKnowledge: buildEmptyProjectKnowledge(),
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
          projectKnowledge: buildEmptyProjectKnowledge(),
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
          projectKnowledge: buildEmptyProjectKnowledge(),
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

  it("returns unchanged and skips the model when source hashes match", async () => {
    const sources = [
      buildSource({
        id: "88888888-8888-4888-8888-888888888888",
        kind: "notion",
        url: "https://www.notion.so/source",
        source_content_hash: "hash:notion",
        last_synced_at: "2026-05-08T12:00:00.000Z",
      }),
      buildSource({
        id: "99999999-9999-4999-8999-999999999999",
        kind: "web_page",
        url: "https://example.test/project",
        source_content_hash: "hash:web",
        last_synced_at: "2026-05-08T12:00:00.000Z",
      }),
    ];
    const project = {
      ...buildProject(),
      aiOptimizedInputHash: inputHashFromSources(sources),
    } satisfies ProjectDimensionRecord;
    const notionFetch = vi.fn().mockResolvedValue({
      ok: true,
      unchanged: true,
      lastModified: "2026-05-09T10:00:00.000Z",
    } satisfies SourceFetchResult);
    const webFetch = vi.fn().mockResolvedValue({
      ok: true,
      unchanged: true,
      lastModified: "2026-05-09T10:00:00.000Z",
    } satisfies SourceFetchResult);
    const setAiKnowledgeSources = vi.fn().mockResolvedValue(undefined);
    const invokeModel = vi.fn();

    const result = await synthesizeProjectKnowledgeOrchestrator(
      {
        repositories: {
          projectDimensions: {
            findById: vi.fn().mockResolvedValue(project),
            getAiKnowledgeSources: vi.fn().mockResolvedValue(sources),
            setAiKnowledgeSources,
          },
          projectKnowledge: buildEmptyProjectKnowledge(),
        },
        fetchers: {
          inline_text: { fetch: vi.fn() },
          notion: { fetch: notionFetch },
          web_page: { fetch: webFetch },
        },
        invokeModel,
      },
      {
        projectId: project.projectId,
        skipIfHashUnchanged: true,
      },
    );

    expect(result).toEqual({
      ok: true,
      unchanged: true,
      sourcesChecked: 2,
      inputHash: inputHashFromSources(sources),
    });
    expect(notionFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        lastModified: "2026-05-08T12:00:00.000Z",
      }),
    );
    expect(webFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        lastModified: "2026-05-08T12:00:00.000Z",
      }),
    );
    expect(setAiKnowledgeSources).toHaveBeenCalledTimes(1);
    expect(invokeModel).not.toHaveBeenCalled();
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
          projectKnowledge: buildEmptyProjectKnowledge(),
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

  it("includes approved-reply examples in the synthesis prompt with weighting language", async () => {
    const project = buildProject();
    const sources = [
      buildSource({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "inline_text",
        url: "https://example.test/inline-1",
      }),
    ];
    const approvedReplies = [
      buildApprovedReply({
        id: "approved:1",
        maskedExample: "Hi {NAME}, thanks for confirming the field logistics.",
        createdAt: "2026-05-08T12:00:00.000Z",
      }),
      buildApprovedReply({
        id: "approved:2",
        maskedExample: "Welcome aboard! Your training kit ships next week.",
        createdAt: "2026-05-07T12:00:00.000Z",
      }),
      buildApprovedReply({
        id: "approved:3",
        maskedExample: "Submit your data through the {APP} portal.",
        createdAt: "2026-05-06T12:00:00.000Z",
      }),
    ];
    const invokeModel = vi.fn().mockResolvedValue(buildDraftResult("# Synthesized"));
    const list = vi.fn().mockResolvedValue(approvedReplies);

    await synthesizeProjectKnowledgeOrchestrator(
      {
        repositories: {
          projectDimensions: {
            findById: vi.fn().mockResolvedValue(project),
            getAiKnowledgeSources: vi.fn().mockResolvedValue(sources),
            setAiKnowledgeSources: vi.fn().mockResolvedValue(undefined),
          },
          projectKnowledge: { list },
        },
        fetchers: {
          inline_text: { fetch: vi.fn().mockResolvedValue(healthyContent("Inline operator context")) },
          notion: { fetch: vi.fn() },
          web_page: { fetch: vi.fn() },
        },
        invokeModel,
      },
      {
        projectId: project.projectId,
      },
    );

    expect(list).toHaveBeenCalledWith({
      projectId: project.projectId,
      approvedOnly: true,
    });
    const prompt = readPromptFromInvokeModelMock(invokeModel);
    expect(prompt).toContain("<APPROVED_REPLY_EXAMPLES>");
    expect(prompt).toContain("</APPROVED_REPLY_EXAMPLES>");
    expect(prompt).toContain("3 canonical reply examples");
    expect(prompt).toContain("weight them MORE HEAVILY");
    expect(prompt).toContain(
      "Hi {NAME}, thanks for confirming the field logistics.",
    );
    expect(prompt).toContain(
      "Welcome aboard! Your training kit ships next week.",
    );
    expect(prompt).toContain("Submit your data through the {APP} portal.");
    expect(prompt).toContain("--- Example 1 (captured 2026-05-08, kind=canonical_reply) ---");
  });

  it("omits the approved-reply block entirely when no approved replies exist", async () => {
    const project = buildProject();
    const sources = [
      buildSource({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "inline_text",
        url: "https://example.test/inline-1",
      }),
    ];
    const invokeModel = vi.fn().mockResolvedValue(buildDraftResult("# Synthesized"));

    await synthesizeProjectKnowledgeOrchestrator(
      {
        repositories: {
          projectDimensions: {
            findById: vi.fn().mockResolvedValue(project),
            getAiKnowledgeSources: vi.fn().mockResolvedValue(sources),
            setAiKnowledgeSources: vi.fn().mockResolvedValue(undefined),
          },
          projectKnowledge: { list: vi.fn().mockResolvedValue([]) },
        },
        fetchers: {
          inline_text: { fetch: vi.fn().mockResolvedValue(healthyContent("Inline operator context")) },
          notion: { fetch: vi.fn() },
          web_page: { fetch: vi.fn() },
        },
        invokeModel,
      },
      {
        projectId: project.projectId,
      },
    );

    const prompt = readPromptFromInvokeModelMock(invokeModel);
    expect(prompt).not.toContain("<APPROVED_REPLY_EXAMPLES>");
    expect(prompt).not.toContain("canonical reply examples");
    expect(prompt).not.toContain("weight them MORE HEAVILY");
  });

  it("caps the approved-reply block at the 50 most recently returned entries", async () => {
    const project = buildProject();
    const sources = [
      buildSource({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "inline_text",
        url: "https://example.test/inline-1",
      }),
    ];
    // The repo returns rows already ordered by desc(updatedAt). The
    // orchestrator should pick the first 50 — items 0..49 — and exclude
    // the rest. We verify by tagging the bodies with their index.
    const approvedReplies = Array.from({ length: 60 }, (_, index) =>
      buildApprovedReply({
        id: `approved:${String(index)}`,
        maskedExample: `EXAMPLE_BODY_${String(index)}`,
        createdAt: `2026-05-${String(8).padStart(2, "0")}T12:00:00.000Z`,
      }),
    );
    const invokeModel = vi.fn().mockResolvedValue(buildDraftResult("# Synthesized"));

    await synthesizeProjectKnowledgeOrchestrator(
      {
        repositories: {
          projectDimensions: {
            findById: vi.fn().mockResolvedValue(project),
            getAiKnowledgeSources: vi.fn().mockResolvedValue(sources),
            setAiKnowledgeSources: vi.fn().mockResolvedValue(undefined),
          },
          projectKnowledge: { list: vi.fn().mockResolvedValue(approvedReplies) },
        },
        fetchers: {
          inline_text: { fetch: vi.fn().mockResolvedValue(healthyContent("Inline operator context")) },
          notion: { fetch: vi.fn() },
          web_page: { fetch: vi.fn() },
        },
        invokeModel,
      },
      {
        projectId: project.projectId,
      },
    );

    const prompt = readPromptFromInvokeModelMock(invokeModel);
    expect(prompt).toContain("50 canonical reply examples");
    expect(prompt).toContain("EXAMPLE_BODY_0");
    expect(prompt).toContain("EXAMPLE_BODY_49");
    expect(prompt).not.toContain("EXAMPLE_BODY_50");
    expect(prompt).not.toContain("EXAMPLE_BODY_59");
  });

  it("excludes non-canonical_reply approved entries from the prompt block", async () => {
    const project = buildProject();
    const sources = [
      buildSource({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "inline_text",
        url: "https://example.test/inline-1",
      }),
    ];
    const approvedReplies = [
      buildApprovedReply({
        id: "approved:reply",
        maskedExample: "CANONICAL_REPLY_BODY",
        createdAt: "2026-05-08T12:00:00.000Z",
        kind: "canonical_reply",
      }),
      buildApprovedReply({
        id: "approved:snippet",
        maskedExample: "SNIPPET_BODY",
        createdAt: "2026-05-08T12:00:00.000Z",
        kind: "snippet",
      }),
      buildApprovedReply({
        id: "approved:pattern",
        maskedExample: "PATTERN_BODY",
        createdAt: "2026-05-08T12:00:00.000Z",
        kind: "pattern",
      }),
    ];
    const invokeModel = vi.fn().mockResolvedValue(buildDraftResult("# Synthesized"));

    await synthesizeProjectKnowledgeOrchestrator(
      {
        repositories: {
          projectDimensions: {
            findById: vi.fn().mockResolvedValue(project),
            getAiKnowledgeSources: vi.fn().mockResolvedValue(sources),
            setAiKnowledgeSources: vi.fn().mockResolvedValue(undefined),
          },
          projectKnowledge: { list: vi.fn().mockResolvedValue(approvedReplies) },
        },
        fetchers: {
          inline_text: { fetch: vi.fn().mockResolvedValue(healthyContent("Inline operator context")) },
          notion: { fetch: vi.fn() },
          web_page: { fetch: vi.fn() },
        },
        invokeModel,
      },
      {
        projectId: project.projectId,
      },
    );

    const prompt = readPromptFromInvokeModelMock(invokeModel);
    expect(prompt).toContain("1 canonical reply examples");
    expect(prompt).toContain("CANONICAL_REPLY_BODY");
    expect(prompt).not.toContain("SNIPPET_BODY");
    expect(prompt).not.toContain("PATTERN_BODY");
  });

  it("renders corpus_example entries into the EMAIL_CORPUS block separately from canonical replies", async () => {
    const project = buildProject();
    const sources = [
      buildSource({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "inline_text",
        url: "https://example.test/inline-1",
      }),
    ];
    const approvedEntries = [
      buildApprovedReply({
        id: "approved:1",
        maskedExample: "CANONICAL_REPLY_TONE",
        createdAt: "2026-05-08T12:00:00.000Z",
        kind: "canonical_reply",
      }),
      buildApprovedReply({
        id: "corpus:1",
        maskedExample: "Hi {NAME}, thanks for the field-data submission.",
        createdAt: "2026-04-22T08:30:00.000Z",
        kind: "corpus_example",
      }),
      buildApprovedReply({
        id: "corpus:2",
        maskedExample: "Welcome aboard {NAME}! Kit ships next week.",
        createdAt: "2026-04-21T08:30:00.000Z",
        kind: "corpus_example",
      }),
    ];
    const invokeModel = vi.fn().mockResolvedValue(buildDraftResult("# Synthesized"));

    await synthesizeProjectKnowledgeOrchestrator(
      {
        repositories: {
          projectDimensions: {
            findById: vi.fn().mockResolvedValue(project),
            getAiKnowledgeSources: vi.fn().mockResolvedValue(sources),
            setAiKnowledgeSources: vi.fn().mockResolvedValue(undefined),
          },
          projectKnowledge: { list: vi.fn().mockResolvedValue(approvedEntries) },
        },
        fetchers: {
          inline_text: { fetch: vi.fn().mockResolvedValue(healthyContent("Inline operator context")) },
          notion: { fetch: vi.fn() },
          web_page: { fetch: vi.fn() },
        },
        invokeModel,
      },
      {
        projectId: project.projectId,
      },
    );

    const prompt = readPromptFromInvokeModelMock(invokeModel);
    // EMAIL_CORPUS block is now populated with corpus_example rows
    expect(prompt).toContain("<EMAIL_CORPUS>");
    expect(prompt).toContain("</EMAIL_CORPUS>");
    expect(prompt).toContain("2 past sent replies");
    expect(prompt).toContain(
      "Hi {NAME}, thanks for the field-data submission.",
    );
    expect(prompt).toContain("Welcome aboard {NAME}! Kit ships next week.");
    expect(prompt).toContain("--- Reply 1 (sent 2026-04-22) ---");
    // Canonical reply still goes in its own dedicated higher-weight block
    expect(prompt).toContain("<APPROVED_REPLY_EXAMPLES>");
    expect(prompt).toContain("CANONICAL_REPLY_TONE");
    // Anti-leak: corpus_example bodies should not appear in the canonical
    // block's authoritative weighting copy
    expect(prompt).toContain("1 canonical reply examples");
  });

  it("renders an empty EMAIL_CORPUS block when no corpus_example rows exist", async () => {
    const project = buildProject();
    const sources = [
      buildSource({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "inline_text",
        url: "https://example.test/inline-1",
      }),
    ];
    const invokeModel = vi.fn().mockResolvedValue(buildDraftResult("# Synthesized"));

    await synthesizeProjectKnowledgeOrchestrator(
      {
        repositories: {
          projectDimensions: {
            findById: vi.fn().mockResolvedValue(project),
            getAiKnowledgeSources: vi.fn().mockResolvedValue(sources),
            setAiKnowledgeSources: vi.fn().mockResolvedValue(undefined),
          },
          projectKnowledge: { list: vi.fn().mockResolvedValue([]) },
        },
        fetchers: {
          inline_text: { fetch: vi.fn().mockResolvedValue(healthyContent("Inline operator context")) },
          notion: { fetch: vi.fn() },
          web_page: { fetch: vi.fn() },
        },
        invokeModel,
      },
      {
        projectId: project.projectId,
      },
    );

    const prompt = readPromptFromInvokeModelMock(invokeModel);
    expect(prompt).toContain("0 past sent replies");
    expect(prompt).toContain("<EMAIL_CORPUS>\n</EMAIL_CORPUS>");
  });

  it("caps the EMAIL_CORPUS block at the 100 most recently returned corpus_example rows", async () => {
    const project = buildProject();
    const sources = [
      buildSource({
        id: "11111111-1111-4111-8111-111111111111",
        kind: "inline_text",
        url: "https://example.test/inline-1",
      }),
    ];
    const corpusEntries = Array.from({ length: 120 }, (_, index) =>
      buildApprovedReply({
        id: `corpus:${String(index)}`,
        maskedExample: `CORPUS_BODY_${String(index)}`,
        createdAt: "2026-04-22T08:30:00.000Z",
        kind: "corpus_example",
      }),
    );
    const invokeModel = vi.fn().mockResolvedValue(buildDraftResult("# Synthesized"));

    await synthesizeProjectKnowledgeOrchestrator(
      {
        repositories: {
          projectDimensions: {
            findById: vi.fn().mockResolvedValue(project),
            getAiKnowledgeSources: vi.fn().mockResolvedValue(sources),
            setAiKnowledgeSources: vi.fn().mockResolvedValue(undefined),
          },
          projectKnowledge: { list: vi.fn().mockResolvedValue(corpusEntries) },
        },
        fetchers: {
          inline_text: { fetch: vi.fn().mockResolvedValue(healthyContent("Inline operator context")) },
          notion: { fetch: vi.fn() },
          web_page: { fetch: vi.fn() },
        },
        invokeModel,
      },
      {
        projectId: project.projectId,
      },
    );

    const prompt = readPromptFromInvokeModelMock(invokeModel);
    expect(prompt).toContain("100 past sent replies");
    expect(prompt).toContain("CORPUS_BODY_0");
    expect(prompt).toContain("CORPUS_BODY_99");
    expect(prompt).not.toContain("CORPUS_BODY_100");
    expect(prompt).not.toContain("CORPUS_BODY_119");
  });
});
