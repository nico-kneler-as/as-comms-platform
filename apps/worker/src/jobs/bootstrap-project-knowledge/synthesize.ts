import { z } from "zod";

import { estimateCostUsd as defaultEstimateCostUsd } from "@as-comms/integrations";

import type { ProjectKnowledgeSourceKind } from "@as-comms/contracts";

const MAX_CHUNK_CHARS = 8_000;
const MAX_TOPICS_PER_CHUNK = 12;
const MAX_TOTAL_TOPICS = 30;

export interface BootstrapSourceDocument {
  readonly sourceId: string;
  readonly kind: ProjectKnowledgeSourceKind;
  readonly label: string | null;
  readonly url: string;
  readonly title: string | null;
  readonly markdown: string;
  readonly wordCount: number;
}

export interface SynthesisModelInput {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly {
    readonly role: "user" | "assistant";
    readonly content: string;
  }[];
  readonly maxTokens: number;
  readonly temperature: number;
}

export interface SynthesisModelResult {
  readonly text: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly stopReason: string | null;
  readonly model: string;
}

export interface SynthesizedKnowledgeCandidate {
  readonly topic: string;
  readonly kind: "canonical_reply" | "snippet" | "pattern";
  readonly issueType: string | null;
  readonly volunteerStage: string | null;
  readonly questionSummary: string;
  readonly replyStrategy: string | null;
  readonly maskedExample: string | null;
  readonly sourceExcerpt: string;
  readonly chunkId: string;
}

export interface SynthesisResult {
  readonly candidates: readonly SynthesizedKnowledgeCandidate[];
  readonly topicsFound: number;
  readonly costEstimateUsd: number;
  readonly modelCalls: number;
  readonly warnings: readonly string[];
}

export interface SynthesizeProjectKnowledgeInput {
  readonly sources: readonly BootstrapSourceDocument[];
  readonly voiceGuide: string | null;
  readonly invokeModel: (input: SynthesisModelInput) => Promise<SynthesisModelResult>;
  readonly estimateCostUsd?: (
    usage: SynthesisModelResult["usage"],
    model: string,
  ) => number;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly logger?: Pick<Console, "warn">;
}

interface SourceChunk {
  readonly chunkId: string;
  readonly source: BootstrapSourceDocument;
  readonly text: string;
}

const topicEvidenceSchema = z.object({
  sourceExcerpt: z.string().min(1),
});

const topicCandidateSchema = z.object({
  topic: z.string().min(1),
  evidence: z.array(topicEvidenceSchema).min(1).default([]),
});

const topicCandidatesSchema = z.array(topicCandidateSchema);

const draftedCandidateSchema = z.object({
  kind: z.enum(["canonical_reply", "snippet", "pattern"]),
  issueType: z.string().min(1).nullable().default(null),
  volunteerStage: z.string().min(1).nullable().default(null),
  questionSummary: z.string().min(1),
  replyStrategy: z.string().min(1).nullable().default(null),
  maskedExample: z.string().min(1).nullable().default(null),
  sourceExcerpt: z.string().min(1),
});

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function extractJsonText(value: string): string {
  const trimmed = value.trim();
  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/iu.exec(trimmed);
  if (fencedMatch?.[1] !== undefined) {
    return fencedMatch[1].trim();
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return trimmed.slice(arrayStart, arrayEnd + 1);
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  return trimmed;
}

function safeJsonParse(value: string): unknown {
  return JSON.parse(extractJsonText(value)) as unknown;
}

function chunkText(text: string, maxChars: number): readonly string[] {
  const normalized = normalizeWhitespace(text);
  if (normalized.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    const slice = remaining.slice(0, maxChars);
    const boundary = Math.max(
      slice.lastIndexOf("\n\n"),
      slice.lastIndexOf(". "),
      slice.lastIndexOf(" "),
    );
    const cutAt = boundary > maxChars * 0.6 ? boundary + 1 : maxChars;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }

  return chunks;
}

function buildChunks(sources: readonly BootstrapSourceDocument[]): readonly SourceChunk[] {
  return sources.flatMap((source) =>
    chunkText(source.markdown, MAX_CHUNK_CHARS).map((text, chunkIndex) => ({
      chunkId: `${source.sourceId}:chunk:${String(chunkIndex + 1)}`,
      source,
      text: [
        `Source kind: ${source.kind}`,
        `Source label: ${source.label ?? source.title ?? source.url}`,
        `Source URL: ${source.url}`,
        "",
        text,
      ].join("\n"),
    })),
  );
}

function buildTopicExtractionPrompt(chunk: SourceChunk): SynthesisModelInput {
  return {
    model: "claude-sonnet-4-6",
    system:
      "Extract grounded volunteer-facing knowledge topics for Adventure Scientists. Return valid JSON only.",
    maxTokens: 1_200,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          "Extract distinct volunteer-facing topics from the following AS project materials.",
          `Output a JSON list with at most ${String(MAX_TOPICS_PER_CHUNK)} items.`,
          'Each item must be {"topic": string, "evidence": [{"sourceExcerpt": string}]}.',
          "Do NOT invent topics not present in the text.",
          "Keep sourceExcerpt short and copied or tightly paraphrased from the supplied text.",
          "",
          `[Chunk ${chunk.chunkId}]`,
          chunk.text,
        ].join("\n"),
      },
    ],
  };
}

function buildCandidateDraftPrompt(input: {
  readonly topic: string;
  readonly evidence: readonly string[];
  readonly voiceGuide: string | null;
}): SynthesisModelInput {
  const voiceGuide = input.voiceGuide?.trim();

  return {
    model: "claude-sonnet-4-6",
    system:
      "Draft one structured project knowledge candidate for Adventure Scientists. Return valid JSON only.",
    maxTokens: 1_200,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: [
          "For this topic, produce a JSON object with:",
          "kind ('canonical_reply'|'snippet'|'pattern'), issueType, volunteerStage (or null), questionSummary, replyStrategy, maskedExample, sourceExcerpt.",
          "replyStrategy is required for canonical_reply and pattern; use null for snippet unless a strategy is essential.",
          "maskedExample is required for canonical_reply; use null for snippet and pattern.",
          "Cite the excerpt used in sourceExcerpt.",
          "Do NOT include names, emails, phone numbers, or other personal identifiers. Use {NAME}, {EMAIL}, and {PHONE} placeholders if needed.",
          "Follow the tier-1 voice guide when drafting replyStrategy or maskedExample.",
          "",
          "[Tier 1 voice guide]",
          voiceGuide === undefined || voiceGuide.length === 0
            ? "(No tier-1 voice guide was available.)"
            : voiceGuide,
          "",
          `[Topic]\n${input.topic}`,
          "",
          "[Evidence excerpts]",
          input.evidence.map((excerpt) => `- ${excerpt}`).join("\n"),
        ].join("\n"),
      },
    ],
  };
}

function mergeModelDefaults(
  input: SynthesisModelInput,
  defaults: {
    readonly model: string;
    readonly maxTokens: number;
    readonly temperature?: number;
  },
): SynthesisModelInput {
  return {
    ...input,
    model: defaults.model,
    maxTokens: defaults.maxTokens,
    temperature: defaults.temperature ?? input.temperature,
  };
}

function addCost(input: {
  readonly total: number;
  readonly result: SynthesisModelResult;
  readonly estimateCostUsd: (
    usage: SynthesisModelResult["usage"],
    model: string,
  ) => number;
}): number {
  return input.total + input.estimateCostUsd(input.result.usage, input.result.model);
}

function normalizeNullableString(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function isUsableCandidate(
  value: z.infer<typeof draftedCandidateSchema>,
): boolean {
  if (
    (value.kind === "canonical_reply" || value.kind === "pattern") &&
    normalizeNullableString(value.replyStrategy) === null
  ) {
    return false;
  }

  if (
    value.kind === "canonical_reply" &&
    normalizeNullableString(value.maskedExample) === null
  ) {
    return false;
  }

  return true;
}

export async function synthesizeProjectKnowledge(
  input: SynthesizeProjectKnowledgeInput,
): Promise<SynthesisResult> {
  const logger = input.logger ?? console;
  const chunks = buildChunks(input.sources);
  const estimateCostUsd = input.estimateCostUsd ?? defaultEstimateCostUsd;
  const model = input.model ?? "claude-sonnet-4-6";
  const maxTokens = input.maxTokens ?? 1_200;
  let costEstimateUsd = 0;
  let modelCalls = 0;
  const warnings: string[] = [];
  const topicsByKey = new Map<
    string,
    { readonly topic: string; readonly evidence: string[]; readonly chunkId: string }
  >();

  for (const chunk of chunks) {
    const result = await input.invokeModel(
      mergeModelDefaults(buildTopicExtractionPrompt(chunk), {
        model,
        maxTokens,
      }),
    );
    modelCalls += 1;
    costEstimateUsd = addCost({ total: costEstimateUsd, result, estimateCostUsd });

    try {
      const parsed = topicCandidatesSchema.parse(safeJsonParse(result.text));
      for (const candidate of parsed.slice(0, MAX_TOPICS_PER_CHUNK)) {
        const key = candidate.topic.toLowerCase().replace(/\s+/gu, " ").trim();
        if (key.length === 0) {
          continue;
        }

        const existing = topicsByKey.get(key);
        const evidence = candidate.evidence
          .map((item) => normalizeWhitespace(item.sourceExcerpt))
          .filter((excerpt) => excerpt.length > 0)
          .slice(0, 3);
        if (existing === undefined) {
          topicsByKey.set(key, {
            topic: normalizeWhitespace(candidate.topic),
            evidence,
            chunkId: chunk.chunkId,
          });
        } else {
          existing.evidence.push(...evidence);
        }
      }
    } catch (error) {
      warnings.push(`Malformed topic JSON for ${chunk.chunkId}.`);
      logger.warn(error instanceof Error ? error.message : String(error));
    }
  }

  const topics = [...topicsByKey.values()].slice(0, MAX_TOTAL_TOPICS);
  const candidates: SynthesizedKnowledgeCandidate[] = [];

  for (const topic of topics) {
    if (topic.evidence.length === 0) {
      continue;
    }

    const result = await input.invokeModel(
      mergeModelDefaults(
        buildCandidateDraftPrompt({
          topic: topic.topic,
          evidence: topic.evidence.slice(0, 5),
          voiceGuide: input.voiceGuide,
        }),
        {
          model,
          maxTokens,
        },
      ),
    );
    modelCalls += 1;
    costEstimateUsd = addCost({ total: costEstimateUsd, result, estimateCostUsd });

    try {
      const parsed = draftedCandidateSchema.parse(safeJsonParse(result.text));
      if (!isUsableCandidate(parsed)) {
        warnings.push(`Incomplete candidate for topic "${topic.topic}".`);
        continue;
      }

      candidates.push({
        topic: topic.topic,
        kind: parsed.kind,
        issueType: normalizeNullableString(parsed.issueType),
        volunteerStage: normalizeNullableString(parsed.volunteerStage),
        questionSummary: normalizeWhitespace(parsed.questionSummary),
        replyStrategy: normalizeNullableString(parsed.replyStrategy),
        maskedExample: normalizeNullableString(parsed.maskedExample),
        sourceExcerpt: normalizeWhitespace(parsed.sourceExcerpt),
        chunkId: topic.chunkId,
      });
    } catch (error) {
      warnings.push(`Malformed candidate JSON for topic "${topic.topic}".`);
      logger.warn(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    candidates,
    topicsFound: topics.length,
    costEstimateUsd,
    modelCalls,
    warnings,
  };
}
