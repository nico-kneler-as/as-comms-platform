import type { Task } from "graphile-worker";

import {
  bootstrapProjectKnowledgeJobName,
  bootstrapProjectKnowledgePayloadSchema,
  type ProjectKnowledgeEntryRecord,
  type ProjectKnowledgeSourceLinkRecord,
} from "@as-comms/contracts";
import type { Stage1RepositoryBundle, Stage2RepositoryBundle } from "@as-comms/domain";
import {
  createAnthropicClient,
  generateDraft,
  estimateCostUsd,
  type GenerateDraftResult,
} from "@as-comms/integrations";
import type { Stage1Database } from "@as-comms/db";

import { digestAliasHistory } from "./fetchers/gmail-alias-history.js";
import { fetchAndExtract } from "./fetchers/html-fetcher.js";
import {
  synthesizeProjectKnowledge,
  type BootstrapSourceDocument,
  type SynthesisModelInput,
  type SynthesisModelResult,
  type SynthesisResult,
} from "./synthesize.js";

export { bootstrapProjectKnowledgeJobName };

interface BootstrapCostState {
  totalUsd: number;
  dayKey: string;
}

declare global {
  var __AS_COMMS_BOOTSTRAP_AI_DAILY_COST_STATE__: BootstrapCostState | undefined;
}

export interface BootstrapProjectKnowledgeDependencies {
  readonly db: Stage1Database;
  readonly repositories: Pick<
    Stage1RepositoryBundle,
    | "aiKnowledge"
    | "projectKnowledge"
    | "projectKnowledgeSourceLinks"
    | "projectKnowledgeBootstrapRuns"
  >;
  readonly settings: Pick<Stage2RepositoryBundle, "aliases">;
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: Pick<Console, "error" | "info" | "warn">;
  readonly now?: () => Date;
  readonly fetchAndExtract?: typeof fetchAndExtract;
  readonly digestAliasHistory?: typeof digestAliasHistory;
  readonly synthesize?: (
    input: Parameters<typeof synthesizeProjectKnowledge>[0],
  ) => Promise<SynthesisResult>;
}

interface BootstrapStats {
  sourcesConfigured: number;
  sourcesFetched: number;
  sourcesFailed: number;
  gmailThreads: number;
  topicsFound: number;
  candidatesWritten: number;
  costEstimateUsd: number;
  budgetWarn: boolean;
  warnings: string[];
}

const HTML_SOURCE_KINDS = new Set<ProjectKnowledgeSourceLinkRecord["kind"]>([
  "public_project_page",
  "volunteer_homepage",
  "training_site",
  "other",
]);

function currentDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function getBootstrapCostState(now: Date): BootstrapCostState {
  globalThis.__AS_COMMS_BOOTSTRAP_AI_DAILY_COST_STATE__ ??= {
    totalUsd: 0,
    dayKey: currentDayKey(now),
  };

  if (
    globalThis.__AS_COMMS_BOOTSTRAP_AI_DAILY_COST_STATE__.dayKey !==
    currentDayKey(now)
  ) {
    globalThis.__AS_COMMS_BOOTSTRAP_AI_DAILY_COST_STATE__ = {
      totalUsd: 0,
      dayKey: currentDayKey(now),
    };
  }

  return globalThis.__AS_COMMS_BOOTSTRAP_AI_DAILY_COST_STATE__;
}

function recordBootstrapCost(input: {
  readonly costEstimateUsd: number;
  readonly dailyCapUsd: number;
  readonly now: Date;
}): boolean {
  const state = getBootstrapCostState(input.now);
  state.totalUsd += input.costEstimateUsd;
  return state.totalUsd >= input.dailyCapUsd;
}

function readOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function readBootstrapAiConfig(env: NodeJS.ProcessEnv) {
  return {
    apiKey: readOptionalString(env.ANTHROPIC_API_KEY),
    model: readOptionalString(env.ANTHROPIC_MODEL) ?? "claude-sonnet-4-6",
    dailyCapUsd:
      env.AI_DAILY_CAP_USD === undefined ||
      Number.isNaN(Number.parseFloat(env.AI_DAILY_CAP_USD))
        ? 20
        : Number.parseFloat(env.AI_DAILY_CAP_USD),
  };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function countWords(value: string): number {
  const normalized = normalizeWhitespace(value);
  if (normalized.length === 0) {
    return 0;
  }

  return normalized.split(/\s+/u).length;
}

function buildInitialStats(sourceCount: number): BootstrapStats {
  return {
    sourcesConfigured: sourceCount,
    sourcesFetched: 0,
    sourcesFailed: 0,
    gmailThreads: 0,
    topicsFound: 0,
    candidatesWritten: 0,
    costEstimateUsd: 0,
    budgetWarn: false,
    warnings: [],
  };
}

async function updateRun(
  dependencies: BootstrapProjectKnowledgeDependencies,
  input: {
    readonly runId: string;
    readonly status?: "queued" | "fetching" | "synthesizing" | "writing" | "done" | "error";
    readonly completedAt?: string | null;
    readonly errorDetail?: string | null;
    readonly stats: BootstrapStats;
  },
) {
  await dependencies.repositories.projectKnowledgeBootstrapRuns.update({
    id: input.runId,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.completedAt === undefined
      ? {}
      : { completedAt: input.completedAt }),
    ...(input.errorDetail === undefined
      ? {}
      : { errorDetail: input.errorDetail }),
    statsJson: {
      ...input.stats,
    },
    updatedAt: (dependencies.now?.() ?? new Date()).toISOString(),
  });
}

async function markRunError(
  dependencies: BootstrapProjectKnowledgeDependencies,
  input: {
    readonly runId: string;
    readonly stats: BootstrapStats;
    readonly errorDetail: string;
  },
): Promise<void> {
  await updateRun(dependencies, {
    runId: input.runId,
    status: "error",
    completedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    errorDetail: input.errorDetail,
    stats: input.stats,
  });
}

function toSourceDocument(input: {
  readonly link: ProjectKnowledgeSourceLinkRecord;
  readonly title: string | null;
  readonly markdown: string;
  readonly wordCount: number;
}): BootstrapSourceDocument {
  return {
    sourceId: input.link.id,
    kind: input.link.kind,
    label: input.link.label,
    url: input.link.url,
    title: input.title,
    markdown: input.markdown,
    wordCount: input.wordCount,
  };
}

function extractRequestedAlias(url: string): string | null {
  const trimmed = url.trim().toLowerCase();
  const mailtoPrefix = "mailto:";
  const candidate = trimmed.startsWith(mailtoPrefix)
    ? trimmed.slice(mailtoPrefix.length)
    : trimmed;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(candidate) ? candidate : null;
}

async function fetchConfiguredSources(
  dependencies: BootstrapProjectKnowledgeDependencies,
  input: {
    readonly projectId: string;
    readonly sourceLinks: readonly ProjectKnowledgeSourceLinkRecord[];
    readonly stats: BootstrapStats;
  },
): Promise<readonly BootstrapSourceDocument[]> {
  const logger = dependencies.logger ?? console;
  const htmlFetcher = dependencies.fetchAndExtract ?? fetchAndExtract;
  const gmailDigest = dependencies.digestAliasHistory ?? digestAliasHistory;
  const docs: BootstrapSourceDocument[] = [];

  for (const link of input.sourceLinks) {
    if (!HTML_SOURCE_KINDS.has(link.kind)) {
      continue;
    }

    try {
      const extracted = await htmlFetcher(link.url);
      if (extracted.wordCount === 0) {
        input.stats.sourcesFailed += 1;
        input.stats.warnings.push(`No extractable text for ${link.url}.`);
        continue;
      }

      docs.push(
        toSourceDocument({
          link,
          title: extracted.title,
          markdown: extracted.markdown,
          wordCount: extracted.wordCount,
        }),
      );
      input.stats.sourcesFetched += 1;
    } catch (error) {
      input.stats.sourcesFailed += 1;
      input.stats.warnings.push(`Failed to fetch ${link.url}.`);
      logger.warn(error instanceof Error ? error.message : String(error));
    }
  }

  const gmailLinks = input.sourceLinks.filter(
    (link) => link.kind === "gmail_alias_history",
  );
  if (gmailLinks.length === 0) {
    return docs;
  }

  const assignedAliases = (await dependencies.settings.aliases.listAssigned()).filter(
    (alias) => alias.projectId === input.projectId,
  );
  const assignedAliasSet = new Set(
    assignedAliases.map((alias) => alias.alias.toLowerCase()),
  );
  const requestedAliases = gmailLinks
    .map((link) => extractRequestedAlias(link.url))
    .filter((alias): alias is string => alias !== null)
    .filter((alias) => assignedAliasSet.has(alias));
  const aliases =
    requestedAliases.length > 0
      ? [...new Set(requestedAliases)]
      : [...assignedAliasSet];
  const sourceLinkForMetadata = gmailLinks[0];

  if (sourceLinkForMetadata === undefined || aliases.length === 0) {
    input.stats.sourcesFailed += gmailLinks.length;
    input.stats.warnings.push(
      "Gmail alias history was configured, but this project has no assigned aliases.",
    );
    return docs;
  }

  for (const alias of aliases) {
    try {
      const digest = await gmailDigest({
        db: dependencies.db,
        projectAlias: alias,
        now: dependencies.now?.() ?? new Date(),
      });
      if (digest.threadCount === 0 || digest.digestMarkdown.trim().length === 0) {
        input.stats.sourcesFailed += 1;
        input.stats.warnings.push(`No Gmail history pairs found for ${alias}.`);
        continue;
      }

      docs.push({
        sourceId: `${sourceLinkForMetadata.id}:${alias}`,
        kind: "gmail_alias_history",
        label: sourceLinkForMetadata.label,
        url: `gmail-alias-history:${alias}`,
        title: `Gmail alias history for ${alias}`,
        markdown: digest.digestMarkdown,
        wordCount: countWords(digest.digestMarkdown),
      });
      input.stats.sourcesFetched += 1;
      input.stats.gmailThreads += digest.threadCount;
    } catch (error) {
      input.stats.sourcesFailed += 1;
      input.stats.warnings.push(`Failed to digest Gmail history for ${alias}.`);
      logger.warn(error instanceof Error ? error.message : String(error));
    }
  }

  return docs;
}

function toSynthesisResult(
  result: GenerateDraftResult,
): SynthesisModelResult {
  return {
    text: result.text,
    usage: result.usage,
    stopReason: result.stopReason,
    model: result.model,
  };
}

function createInvokeModel(env: NodeJS.ProcessEnv): {
  readonly invokeModel: ((input: SynthesisModelInput) => Promise<SynthesisModelResult>) | null;
  readonly model: string;
  readonly dailyCapUsd: number;
} {
  const config = readBootstrapAiConfig(env);

  if (config.apiKey === null) {
    return {
      invokeModel: null,
      model: config.model,
      dailyCapUsd: config.dailyCapUsd,
    };
  }

  const client = createAnthropicClient({
    ANTHROPIC_API_KEY: config.apiKey,
  });

  return {
    model: config.model,
    dailyCapUsd: config.dailyCapUsd,
    invokeModel: async (input) =>
      toSynthesisResult(
        await generateDraft(client, {
          model: input.model,
          system: input.system,
          messages: input.messages,
          maxTokens: input.maxTokens,
          temperature: input.temperature,
        }),
      ),
  };
}

function buildKnowledgeEntry(input: {
  readonly candidate: SynthesisResult["candidates"][number];
  readonly projectId: string;
  readonly runId: string;
  readonly index: number;
  readonly nowIso: string;
}): ProjectKnowledgeEntryRecord {
  return {
    id: `project_knowledge:bootstrap:${input.runId}:${String(input.index + 1)}`,
    projectId: input.projectId,
    kind: input.candidate.kind,
    issueType: input.candidate.issueType,
    volunteerStage: input.candidate.volunteerStage,
    questionSummary: input.candidate.questionSummary,
    replyStrategy: input.candidate.replyStrategy,
    maskedExample: input.candidate.maskedExample,
    sourceKind: "bootstrap_synthesized",
    approvedForAi: false,
    sourceEventId: null,
    metadataJson: {
      bootstrapRunId: input.runId,
      topic: input.candidate.topic,
      sourceExcerpt: input.candidate.sourceExcerpt,
      chunkId: input.candidate.chunkId,
    },
    lastReviewedAt: null,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };
}

export async function runBootstrapProjectKnowledge(
  dependencies: BootstrapProjectKnowledgeDependencies,
  rawPayload: unknown,
): Promise<void> {
  const logger = dependencies.logger ?? console;
  const payload = bootstrapProjectKnowledgePayloadSchema.parse(rawPayload);
  const run = await dependencies.repositories.projectKnowledgeBootstrapRuns.findById(
    payload.runId,
  );

  if (run === null) {
    throw new Error(`Bootstrap run ${payload.runId} does not exist.`);
  }

  const sourceLinks = await dependencies.repositories.projectKnowledgeSourceLinks.list(
    payload.projectId,
  );
  const stats = buildInitialStats(sourceLinks.length);
  const force = payload.force || run.force;

  if (sourceLinks.length === 0) {
    await markRunError(dependencies, {
      runId: payload.runId,
      stats,
      errorDetail:
        "No knowledge source links are configured for this project. Add at least one source before generating baseline knowledge.",
    });
    return;
  }

  const existingEntries = await dependencies.repositories.projectKnowledge.list({
    projectId: payload.projectId,
  });
  if (existingEntries.length > 50 && !force) {
    await markRunError(dependencies, {
      runId: payload.runId,
      stats,
      errorDetail:
        "This project already has more than 50 knowledge entries. Confirm generation to run bootstrap anyway.",
    });
    return;
  }

  try {
    await updateRun(dependencies, {
      runId: payload.runId,
      status: "fetching",
      stats,
    });

    const sourceDocuments = await fetchConfiguredSources(dependencies, {
      projectId: payload.projectId,
      sourceLinks,
      stats,
    });

    if (sourceDocuments.length === 0) {
      await markRunError(dependencies, {
        runId: payload.runId,
        stats,
        errorDetail:
          "Knowledge sources were configured, but no extractable source text was available.",
      });
      return;
    }

    await updateRun(dependencies, {
      runId: payload.runId,
      status: "synthesizing",
      stats,
    });

    const voiceGuide = await dependencies.repositories.aiKnowledge.findByScope({
      scope: "global",
      scopeKey: null,
    });
    const modelConfig = createInvokeModel(dependencies.env ?? process.env);
    if (modelConfig.invokeModel === null && dependencies.synthesize === undefined) {
      await markRunError(dependencies, {
        runId: payload.runId,
        stats,
        errorDetail:
          "ANTHROPIC_API_KEY is not configured for the bootstrap synthesis worker.",
      });
      return;
    }

    const synthesis = await (dependencies.synthesize ?? synthesizeProjectKnowledge)({
      sources: sourceDocuments,
      voiceGuide: voiceGuide?.content ?? null,
      invokeModel:
        modelConfig.invokeModel ??
        (() =>
          Promise.reject(
            new Error("Anthropic model invocation is not configured."),
          )),
      estimateCostUsd,
      model: modelConfig.model,
      logger,
    });

    stats.topicsFound = synthesis.topicsFound;
    stats.costEstimateUsd = synthesis.costEstimateUsd;
    stats.warnings.push(...synthesis.warnings);
    stats.budgetWarn = recordBootstrapCost({
      costEstimateUsd: synthesis.costEstimateUsd,
      dailyCapUsd: modelConfig.dailyCapUsd,
      now: dependencies.now?.() ?? new Date(),
    });

    await updateRun(dependencies, {
      runId: payload.runId,
      status: "writing",
      stats,
    });

    const nowIso = (dependencies.now?.() ?? new Date()).toISOString();
    for (const [index, candidate] of synthesis.candidates.entries()) {
      await dependencies.repositories.projectKnowledge.upsert(
        buildKnowledgeEntry({
          candidate,
          projectId: payload.projectId,
          runId: payload.runId,
          index,
          nowIso,
        }),
      );
      stats.candidatesWritten += 1;
    }

    await updateRun(dependencies, {
      runId: payload.runId,
      status: "done",
      completedAt: (dependencies.now?.() ?? new Date()).toISOString(),
      stats,
    });
  } catch (error) {
    const errorDetail = error instanceof Error ? error.message : String(error);
    logger.error(errorDetail);
    await markRunError(dependencies, {
      runId: payload.runId,
      stats,
      errorDetail,
    });
  }
}

export function createBootstrapProjectKnowledgeTask(
  dependencies: BootstrapProjectKnowledgeDependencies,
): Task {
  return async (payload) => {
    await runBootstrapProjectKnowledge(dependencies, payload);
  };
}
