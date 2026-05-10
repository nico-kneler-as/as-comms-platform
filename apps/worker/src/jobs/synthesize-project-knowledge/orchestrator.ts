import type {
  AiKnowledgeSource,
  ProjectDimensionRecord,
  ProjectKnowledgeEntryRecord,
} from "@as-comms/contracts";
import { inputHashFromSources, markSourceSyncResult } from "@as-comms/db";
import type {
  ProjectDimensionRepository,
  ProjectKnowledgeRepository,
} from "@as-comms/domain";
import {
  estimateCostUsd,
  type GenerateDraftResult,
  type SourceFetchResult,
} from "@as-comms/integrations";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 16_000;
const DEFAULT_TEMPERATURE = 0.3;
const APPROVED_REPLY_PROMPT_LIMIT = 50;
// Cap on backfilled / accumulated bulk corpus examples sent into the
// EMAIL_CORPUS prompt block. Lower-weighted than approved canonical
// replies; volume matters here for tone/pattern distillation, but going
// past ~100 inflates input tokens without proportional signal gain.
const CORPUS_PROMPT_LIMIT = 100;
// Synthesis bundles every healthy source document into one prompt and asks
// for up to DEFAULT_MAX_TOKENS back. The default Anthropic timeout (25s)
// fits inbox AI drafts but kills synthesis runs that span 30-90s. Confirmed
// 2026-05-10 in worker logs: aborts at ~25s on PNW Biodiversity (8 sources).
const DEFAULT_SYNTHESIS_TIMEOUT_MS = 180_000;

export const SYNTHESIS_SYSTEM_PROMPT = `You are organizing an AI training document for a volunteer communications assistant. Your output will be used by an AI to draft replies to volunteers for a specific project.

INPUTS:
- An existing AI Knowledge document (operator-curated; may be partially structured or terse)
- Optionally one or more additional source documents (e.g., volunteer homepage, field protocol PDF, training course content)
- A corpus of past sent replies from this project's volunteer alias(es)

PRODUCE: a comprehensive, self-contained updated AI Knowledge document organized in the following standard structure (adapt section content to the project — but keep these section names and order):

1. **Intro paragraph** — what this page is, what it excludes (internal-only material), what sources were merged.

2. **## What this project is** — 4-6 sentence description of the project (mission, geographic scope, partners, target species/output, how the volunteer experience is shaped).

3. **## What this AI assistant should help with** — bullet list of the AI's scope (volunteer-facing topics it should address, what to prefer, when to be careful about seasonality).

4. **## Tone signals from real volunteer messages** — 6-12 bullets distilled from the email corpus. Cover dominant emotional patterns, common support themes, recurring frustrations, things operators handle gracefully. Keep the most insightful observations from the existing doc's equivalent section if the new corpus confirms them.

5. **## Common volunteer questions and approved answer patterns** — the new corpus-derived section. 8-15 clusters ordered by frequency. For each:
   ### {Topic name as a noun phrase}
   - **Volunteer typically asks:** {paraphrased pattern, anonymized}
   - **Approved answer pattern:** {synthesized voice, 2-4 sentences, based on how operators actually responded}
   - **Tone notes:** {tone signals for this topic}
   - **Approximate frequency:** {very common (>20), common (10-20), occasional (5-10), uncommon but recurring}

6. **## Volunteer-facing facts** — sectioned by topic. Use H3 subsections (### Getting started, ### Fieldwork, ### Equipment, ### Species/target identification, ### Navigation, ### Project timing, etc.) as appropriate for the project. Pull facts from the existing doc AND the additional source documents, deduplicating.

7. **## Phrase these carefully (date-bound or contingent)** — bullets of claims the AI should hedge.

8. **## Never share with volunteers** — bullets of operator-only material.

9. **## Escalate to a human teammate when** — handoff conditions.

10. **## Contact** — project email, general lines, mailing address.

INTEGRATION RULES:
- Treat the existing AI Knowledge doc as authoritative for the project's tone-curated sections (phrase carefully, never share, escalate). Preserve their content; you may rephrase for clarity but do not drop items.
- Treat additional source documents as fact sources. Integrate their unique facts into the appropriate "Volunteer-facing facts" subsections. Do not preserve them verbatim.
- If an additional source contains a knowledge check / quiz, the topics in the quiz indicate what volunteers must know.
- De-duplicate content across all inputs.

PII MASKING in corpus-derived content:
- Replace volunteer first names with {NAME}
- Replace full email addresses with {EMAIL}
- Replace phone numbers with {PHONE}
- Preserve project-specific terms (app names, geographic names, species names, dates, elevations, etc.)

NEVER:
- Invent facts not present in any input
- Include specific volunteer names or PII
- Include one-off operational issues that don't generalize
- Include internal/operator-only commentary
- Add sections beyond what's specified

OUTPUT FORMAT: markdown with H1, H2, H3 headings and bullet lists. Output ONLY the markdown — no preamble, no closing remarks.`;

export interface SynthesizeProjectKnowledgePayload {
  readonly projectId: string;
  readonly skipIfHashUnchanged?: boolean;
}

export interface SynthesizeProjectKnowledgeOrchestratorDependencies {
  readonly fetchers: {
    readonly notion: {
      fetch(input: {
        readonly url: string;
        readonly sourceId: string | null;
        readonly lastContentHash: string | null;
        readonly lastModified?: string | null;
      }): Promise<SourceFetchResult>;
    };
    readonly web_page: {
      fetch(input: {
        readonly url: string;
        readonly sourceId: string | null;
        readonly lastContentHash: string | null;
        readonly lastModified?: string | null;
      }): Promise<SourceFetchResult>;
    };
    readonly inline_text: {
      fetch(input: {
        readonly url: string;
        readonly sourceId: string | null;
        readonly lastContentHash: string | null;
        readonly lastModified?: string | null;
      }): Promise<SourceFetchResult>;
    };
  };
  readonly invokeModel: (input: {
    readonly model: string;
    readonly system: string;
    readonly messages: readonly {
      readonly role: "user" | "assistant";
      readonly content: string;
    }[];
    readonly maxTokens: number;
    readonly temperature: number;
    readonly timeoutMs?: number;
  }) => Promise<GenerateDraftResult>;
  readonly logger?: Pick<Console, "info" | "warn" | "error">;
  readonly model?: string;
  readonly now?: () => Date;
  readonly maxTokens?: number;
  readonly repositories: {
    readonly projectDimensions: Pick<
      ProjectDimensionRepository,
      "findById" | "getAiKnowledgeSources" | "setAiKnowledgeSources"
    >;
    readonly projectKnowledge: Pick<ProjectKnowledgeRepository, "list">;
  };
  readonly temperature?: number;
}

export type SynthesizeProjectKnowledgeOrchestratorResult =
  | {
      readonly ok: true;
      readonly content: string;
      readonly costUsd: number;
      readonly inputHash: string | null;
      readonly model: string;
      readonly project: ProjectDimensionRecord;
      readonly sourcesUsed: number;
      readonly tokensIn: number;
      readonly tokensOut: number;
    }
  | {
      readonly ok: true;
      readonly unchanged: true;
      readonly sourcesChecked: number;
    }
  | {
      readonly ok: false;
      readonly code: "project_missing" | "no_healthy_sources";
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly code: "llm_failed";
      readonly error: unknown;
      readonly message: string;
    };

interface HealthySourceContent {
  readonly content: string;
  readonly source: AiKnowledgeSource;
}

interface SourceSyncPassResult {
  readonly healthyRegistrySources: readonly AiKnowledgeSource[];
  readonly healthySources: readonly HealthySourceContent[];
  readonly nextSources: readonly AiKnowledgeSource[];
  readonly sourcesChecked: number;
}

function buildAdditionalSourcesBlock(
  sources: readonly HealthySourceContent[],
): string {
  const externalSources = sources.filter(
    (source) =>
      source.source.kind === "notion" || source.source.kind === "web_page",
  );

  return externalSources
    .map((source, index) => {
      const label = source.source.label ?? source.source.url;
      const tagName = `ADDITIONAL_SOURCE_${String(index + 1)}`;
      return `<${tagName} path="${label}">
${source.content}
</${tagName}>`;
    })
    .join("\n\n");
}

function buildApprovedReplyExamplesBlock(
  approvedReplies: readonly ProjectKnowledgeEntryRecord[],
): string {
  if (approvedReplies.length === 0) {
    return "";
  }

  const renderedExamples = approvedReplies
    .map((reply, index) => {
      const capturedAt = reply.createdAt.slice(0, 10);
      const example = reply.maskedExample?.trim() ?? "";
      return `--- Example ${String(index + 1)} (captured ${capturedAt}, kind=${reply.kind}) ---
${example}`;
    })
    .join("\n\n");

  return `

Here are ${String(approvedReplies.length)} canonical reply examples that the operator has marked as exemplary via "Send and save for AI". These represent the gold standard for tone, structure, and approved phrasing for this project. Treat them as authoritative examples of how the team replies; weight them MORE HEAVILY than ordinary inbox-corpus patterns when synthesizing the FAQ section and tone signals.

<APPROVED_REPLY_EXAMPLES>
${renderedExamples}
</APPROVED_REPLY_EXAMPLES>`;
}

function buildEmailCorpusBlock(
  corpusEntries: readonly ProjectKnowledgeEntryRecord[],
): string {
  if (corpusEntries.length === 0) {
    return `Here is the corpus of 0 past sent replies from this project's volunteer alias(es), most recent first:

<EMAIL_CORPUS>
</EMAIL_CORPUS>`;
  }

  const renderedExamples = corpusEntries
    .map((entry, index) => {
      const capturedAt = entry.createdAt.slice(0, 10);
      const example = entry.maskedExample?.trim() ?? "";
      return `--- Reply ${String(index + 1)} (sent ${capturedAt}) ---
${example}`;
    })
    .join("\n\n");

  return `Here is the corpus of ${String(corpusEntries.length)} past sent replies from this project's volunteer alias(es), most recent first. Use it to distill tone signals, common volunteer questions, and recurring approved-answer patterns. Volume here is for pattern extraction; do NOT treat any single message as authoritative the way an APPROVED_REPLY_EXAMPLE entry would be — corpus messages are unreviewed historical sends.

<EMAIL_CORPUS>
${renderedExamples}
</EMAIL_CORPUS>`;
}

function buildUserContent(input: {
  readonly healthySources: readonly HealthySourceContent[];
  readonly approvedReplies: readonly ProjectKnowledgeEntryRecord[];
  readonly corpusEntries: readonly ProjectKnowledgeEntryRecord[];
}): string {
  const inlineDocs = input.healthySources
    .filter((source) => source.source.kind === "inline_text")
    .map((source) => source.content.trim())
    .filter((content) => content.length > 0);
  const existingDoc =
    inlineDocs.length === 0 ? "(none)" : inlineDocs.join("\n\n---\n\n");
  const additionalSourcesBlock = buildAdditionalSourcesBlock(
    input.healthySources,
  );
  const externalSourceCount = input.healthySources.filter(
    (source) =>
      source.source.kind === "notion" || source.source.kind === "web_page",
  ).length;
  const additionalSourcesNote =
    additionalSourcesBlock.length === 0
      ? ""
      : `

Here are ${String(externalSourceCount)} additional source document(s) for this project (e.g., training course content, supplementary protocols). Integrate any unique facts from these into the appropriate sections of the AI Knowledge doc. Do not preserve them verbatim — overlap with the existing doc is expected and should be deduplicated. If the additional source contains a knowledge check / quiz, treat the quiz topics as a signal of what volunteers must know (and what the AI should be ready to support).

${additionalSourcesBlock}`;
  const approvedRepliesNote = buildApprovedReplyExamplesBlock(
    input.approvedReplies,
  );
  const emailCorpusBlock = buildEmailCorpusBlock(input.corpusEntries);

  return `Here is the existing AI Knowledge document for the project:

<EXISTING_DOC>
${existingDoc}
</EXISTING_DOC>${additionalSourcesNote}

${emailCorpusBlock}${approvedRepliesNote}

Produce the updated AI Knowledge document per the system instructions. Output ONLY the markdown.`;
}

function applyFetchResult(
  sources: readonly AiKnowledgeSource[],
  source: AiKnowledgeSource,
  result: SourceFetchResult,
): readonly AiKnowledgeSource[] {
  if (!result.ok) {
    return markSourceSyncResult(sources, source.id, {
      last_sync_status: "broken",
      last_sync_error: result.error,
      source_content_hash: null,
    });
  }

  if (result.unchanged) {
    return markSourceSyncResult(sources, source.id, {
      last_sync_status: "healthy",
      last_sync_error: null,
      source_content_hash: source.source_content_hash,
    });
  }

  if (result.content.trim().length === 0) {
    return markSourceSyncResult(sources, source.id, {
      last_sync_status: "stale",
      last_sync_error: "Fetched source content was empty.",
      source_content_hash: null,
    });
  }

  return markSourceSyncResult(sources, source.id, {
    last_sync_status: "healthy",
    last_sync_error: null,
    source_content_hash: result.contentHash,
  });
}

async function runSourceSyncPass(
  deps: SynthesizeProjectKnowledgeOrchestratorDependencies,
  input: {
    readonly sources: readonly AiKnowledgeSource[];
    readonly useLastModified: boolean;
  },
): Promise<SourceSyncPassResult> {
  const enabledSources = input.sources.filter((source) => source.enabled);
  let nextSources = input.sources;
  const healthySources: HealthySourceContent[] = [];

  for (const source of enabledSources) {
    const fetcher = deps.fetchers[source.kind];
    const result = await fetcher.fetch({
      url: source.url,
      sourceId: source.source_id,
      lastContentHash: source.source_content_hash,
      ...(input.useLastModified
        ? { lastModified: source.last_synced_at }
        : {}),
    });

    nextSources = applyFetchResult(nextSources, source, result);

    if (!result.ok || result.unchanged || result.content.trim().length === 0) {
      continue;
    }

    healthySources.push({
      source,
      content: result.content,
    });
  }

  return {
    nextSources,
    healthySources,
    healthyRegistrySources: nextSources.filter(
      (source) =>
        source.enabled &&
        source.last_sync_status === "healthy" &&
        source.source_content_hash !== null,
    ),
    sourcesChecked: enabledSources.length,
  };
}

export async function synthesizeProjectKnowledgeOrchestrator(
  deps: SynthesizeProjectKnowledgeOrchestratorDependencies,
  payload: SynthesizeProjectKnowledgePayload,
): Promise<SynthesizeProjectKnowledgeOrchestratorResult> {
  const logger = deps.logger ?? console;
  const project = await deps.repositories.projectDimensions.findById(
    payload.projectId,
  );

  if (project === null) {
    return {
      ok: false,
      code: "project_missing",
      message: `Project ${payload.projectId} was not found.`,
    };
  }

  const sources = await deps.repositories.projectDimensions.getAiKnowledgeSources(
    payload.projectId,
  );
  let syncPass = await runSourceSyncPass(deps, {
    sources,
    useLastModified: payload.skipIfHashUnchanged === true,
  });

  await deps.repositories.projectDimensions.setAiKnowledgeSources(
    payload.projectId,
    syncPass.nextSources,
  );

  if (syncPass.healthyRegistrySources.length === 0) {
    return {
      ok: false,
      code: "no_healthy_sources",
      message: `Project ${payload.projectId} has no healthy AI knowledge sources to synthesize.`,
    };
  }

  const nextInputHash = inputHashFromSources(syncPass.healthyRegistrySources);
  if (
    payload.skipIfHashUnchanged === true &&
    nextInputHash === project.aiOptimizedInputHash
  ) {
    return {
      ok: true,
      unchanged: true,
      sourcesChecked: syncPass.sourcesChecked,
    };
  }

  if (payload.skipIfHashUnchanged === true) {
    syncPass = await runSourceSyncPass(deps, {
      sources: syncPass.nextSources,
      useLastModified: false,
    });

    await deps.repositories.projectDimensions.setAiKnowledgeSources(
      payload.projectId,
      syncPass.nextSources,
    );
  }

  if (syncPass.healthySources.length === 0) {
    return {
      ok: false,
      code: "no_healthy_sources",
      message: `Project ${payload.projectId} has no healthy AI knowledge sources to synthesize.`,
    };
  }

  // Phase 3 of PRD #366: weight operator-approved replies as canonical
  // examples in synthesis. The capture path flips approvedForAi=true on
  // every "Send and save for AI" click, so listing approved canonical
  // replies returns the operator's curated tone/structure exemplars.
  const allApprovedKnowledge =
    await deps.repositories.projectKnowledge.list({
      projectId: payload.projectId,
      approvedOnly: true,
    });
  const approvedReplies = allApprovedKnowledge
    .filter((entry) => entry.kind === "canonical_reply")
    .slice(0, APPROVED_REPLY_PROMPT_LIMIT);
  // 2026-05-10: bulk corpus from historical outbounds, backfilled per
  // project via apps/worker/src/ops/backfill-project-corpus.ts. Lower
  // training weight than canonical_reply (see system prompt + corpus
  // block copy) but provides the volume needed for the prompt's
  // "Common volunteer questions and approved answer patterns" section.
  const corpusEntries = allApprovedKnowledge
    .filter((entry) => entry.kind === "corpus_example")
    .slice(0, CORPUS_PROMPT_LIMIT);

  try {
    const model = deps.model ?? DEFAULT_MODEL;
    const response = await deps.invokeModel({
      model,
      system: SYNTHESIS_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildUserContent({
            healthySources: syncPass.healthySources,
            approvedReplies,
            corpusEntries,
          }),
        },
      ],
      maxTokens: deps.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: deps.temperature ?? DEFAULT_TEMPERATURE,
      timeoutMs: DEFAULT_SYNTHESIS_TIMEOUT_MS,
    });

    return {
      ok: true,
      project,
      content: response.text,
      inputHash: inputHashFromSources(syncPass.healthyRegistrySources),
      tokensIn: response.usage.inputTokens,
      tokensOut: response.usage.outputTokens,
      costUsd: estimateCostUsd(response.usage, response.model),
      model: response.model,
      sourcesUsed: syncPass.healthySources.length,
    };
  } catch (error) {
    logger.error(
      `AI knowledge synthesis failed for ${payload.projectId}: ${error instanceof Error ? error.message : String(error)}`,
    );

    return {
      ok: false,
      code: "llm_failed",
      error,
      message: `AI knowledge synthesis failed for ${payload.projectId}.`,
    };
  }
}
