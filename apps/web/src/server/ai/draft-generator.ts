import { randomUUID } from "node:crypto";

import type { Stage1RepositoryBundle } from "@as-comms/domain";

import { buildSkeletonDraft } from "./fallback-builder";
import { buildPrompt, buildPromptPreview } from "./prompt-builder";
import { getDailyTotal, isOverBudget, record } from "./cost-counter";
import { retrieveGrounding } from "./retriever";
import {
  aiDraftRequestSchema,
  type AiDraftRequest,
  type AiDraftResponse,
  type AiDraftWarning,
} from "./types";
import { validateDraft } from "./validator";

interface ModelDraftResult {
  readonly text: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly stopReason: string | null;
  readonly model: string;
}

export interface GenerateAiDraftDeps {
  readonly repositories: Pick<
    Stage1RepositoryBundle,
    | "aiKnowledge"
    | "canonicalEvents"
    | "contacts"
    | "gmailMessageDetails"
    | "salesforceCommunicationDetails"
    | "simpleTextingMessageDetails"
  >;
  readonly invokeModel:
    | ((input: {
        readonly model: string;
        readonly system: string;
        readonly messages: readonly {
          readonly role: "user" | "assistant";
          readonly content: string;
        }[];
        readonly maxTokens: number;
        readonly temperature: number;
      }) => Promise<ModelDraftResult>)
    | null;
  readonly estimateCostUsd: (
    usage: ModelDraftResult["usage"],
    model: string,
  ) => number;
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly dailyCapUsd: number;
  readonly logger?: Pick<Console, "error" | "info" | "warn">;
  readonly now?: () => Date;
}

function buildWarning(code: AiDraftWarning["code"], message: string): AiDraftWarning {
  return {
    code,
    message,
  };
}

function extractContradictionMarker(draft: string): {
  readonly cleanedDraft: string;
  readonly warning: AiDraftWarning | null;
} {
  const markerMatch = /\[NOTE:\s*([^\]]+)\]/u.exec(draft);

  if (markerMatch === null) {
    return {
      cleanedDraft: draft.trim(),
      warning: null,
    };
  }

  return {
    cleanedDraft: draft.replace(markerMatch[0], "").trim(),
    warning: buildWarning(
      "grounding_contradiction",
      markerMatch[1]?.trim() ??
        "The directive may conflict with the project context.",
    ),
  };
}

function buildFallbackResponse(input: {
  readonly request: AiDraftRequest;
  readonly bundle: Awaited<ReturnType<typeof retrieveGrounding>>;
  readonly warning: AiDraftWarning;
  readonly providerStatus: AiDraftResponse["providerStatus"];
  readonly promptPreview: string;
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
}): AiDraftResponse {
  return {
    draft: buildSkeletonDraft({
      inbound: input.bundle.targetInbound?.body ?? "",
      contact: input.bundle.contact,
      warning: input.warning.code,
    }),
    requestMode: input.request.mode,
    mode: "deterministic_fallback",
    grounding: input.bundle.grounding,
    warnings: [input.warning],
    costEstimateUsd: 0,
    providerStatus: input.providerStatus,
    draftId: randomUUID(),
    repromptIndex: input.request.repromptIndex,
    promptPreview: input.promptPreview,
    model: {
      name: input.model,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      inputTokens: 0,
      outputTokens: 0,
      stopReason: null,
    },
  };
}

export async function generateAiDraft(
  deps: GenerateAiDraftDeps,
  request: AiDraftRequest,
): Promise<AiDraftResponse> {
  const parsedRequest = aiDraftRequestSchema.parse(request);
  const logger = deps.logger ?? console;
  const bundle = await retrieveGrounding(
    deps.repositories,
    parsedRequest,
    logger,
  );
  const prompt = buildPrompt(bundle, parsedRequest);
  const promptPreview = buildPromptPreview(prompt);
  const warnings: AiDraftWarning[] = [];
  const missingProjectContext =
    parsedRequest.projectId !== null && bundle.projectContext === null;
  const missingCanonicalKnowledge =
    bundle.generalTraining === null && bundle.projectContext === null;

  if (bundle.generalTraining === null || missingProjectContext) {
    warnings.push(
      buildWarning(
        "grounding_empty",
        missingProjectContext
          ? "Project-specific AI grounding is missing for this contact."
          : "Global AI grounding is missing for this contact.",
      ),
    );
  }

  if (deps.invokeModel === null) {
    return buildFallbackResponse({
      request: parsedRequest,
      bundle,
      warning: buildWarning(
        "provider_not_configured",
        "Anthropic is not configured for web drafting.",
      ),
      providerStatus: "provider_not_configured",
      promptPreview,
      model: deps.model,
      temperature: deps.temperature,
      maxTokens: deps.maxTokens,
    });
  }

  if (missingCanonicalKnowledge) {
    return buildFallbackResponse({
      request: parsedRequest,
      bundle,
      warning: buildWarning(
        "grounding_empty",
        "AI drafting does not have enough grounded knowledge for this contact yet.",
      ),
      providerStatus: "validation_blocked",
      promptPreview,
      model: deps.model,
      temperature: deps.temperature,
      maxTokens: deps.maxTokens,
    });
  }

  try {
    const modelResult = await deps.invokeModel({
      model: deps.model,
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: deps.maxTokens,
      temperature: deps.temperature,
    });
    const contradiction = extractContradictionMarker(modelResult.text);

    if (contradiction.warning !== null) {
      warnings.push(contradiction.warning);
    }

    const validated = validateDraft(contradiction.cleanedDraft, bundle);

    if (!validated.ok) {
      return buildFallbackResponse({
        request: parsedRequest,
        bundle,
        warning: buildWarning(
          "validation_blocked",
          validated.reasons.join(" "),
        ),
        providerStatus: "validation_blocked",
        promptPreview,
        model: deps.model,
        temperature: deps.temperature,
        maxTokens: deps.maxTokens,
      });
    }

    const costEstimateUsd = deps.estimateCostUsd(
      modelResult.usage,
      modelResult.model,
    );
    const now = deps.now?.() ?? new Date();
    record(costEstimateUsd, now);

    if (isOverBudget(deps.dailyCapUsd, now)) {
      warnings.push(
        buildWarning(
          "budget_warn",
          `The projected AI draft spend is over the $${deps.dailyCapUsd.toFixed(
            2,
          )} daily soft cap.`,
        ),
      );
    }

    if (parsedRequest.mode === "reprompt") {
      logger.info("AI draft reprompt completed.", {
        draftId: randomUUID(),
        repromptIndex: parsedRequest.repromptIndex,
        projectedDailyTotalUsd: getDailyTotal(now),
      });
    }

    return {
      draft: contradiction.cleanedDraft,
      requestMode: parsedRequest.mode,
      mode: "generated",
      grounding: bundle.grounding,
      warnings,
      costEstimateUsd,
      providerStatus: "ready",
      draftId: randomUUID(),
      repromptIndex: parsedRequest.repromptIndex,
      promptPreview,
      model: {
        name: modelResult.model,
        temperature: deps.temperature,
        maxTokens: deps.maxTokens,
        inputTokens: modelResult.usage.inputTokens,
        outputTokens: modelResult.usage.outputTokens,
        stopReason: modelResult.stopReason,
      },
    };
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "provider_unavailable";

    const providerStatus =
      code === "provider_timeout" ||
      code === "provider_rate_limited" ||
      code === "provider_unavailable"
        ? code
        : "provider_unavailable";

    return buildFallbackResponse({
      request: parsedRequest,
      bundle,
      warning: buildWarning(
        providerStatus,
        error instanceof Error ? error.message : "AI drafting failed.",
      ),
      providerStatus,
      promptPreview,
      model: deps.model,
      temperature: deps.temperature,
      maxTokens: deps.maxTokens,
    });
  }
}

