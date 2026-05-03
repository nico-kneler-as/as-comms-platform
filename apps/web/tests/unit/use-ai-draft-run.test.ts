import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../app/inbox/actions", () => ({
  draftWithAiAction: vi.fn(),
}));

import { useAiDraftRun } from "../../app/inbox/_hooks/use-ai-draft-run";
import type { AiDraftState } from "../../app/inbox/_components/inbox-client-provider";
import { INITIAL_COMPOSER_DRAFT_STATE } from "../../app/inbox/_hooks/composer-draft-reducer";

const baseAiDraft: AiDraftState = {
  status: "reviewable",
  mode: "draft",
  responseMode: "generated",
  prompt: "Draft with AI",
  generatedText: "AI draft",
  errorMessage: null,
  grounding: [],
  warnings: [],
  costEstimateUsd: null,
  draftId: "draft-1",
  repromptIndex: 0,
  repromptChain: [],
  promptPreview: "preview",
  model: null,
  lastRequest: null,
};

function setup(input?: {
  readonly aiDraft?: AiDraftState;
  readonly body?: string;
}) {
  const dispatch = vi.fn();
  const approveAiDraft = vi.fn();
  const controls = useAiDraftRun({
    state: {
      ...INITIAL_COMPOSER_DRAFT_STATE,
      body: input?.body ?? "",
    },
    dispatch,
    aiDraft: input?.aiDraft ?? baseAiDraft,
    selectedAliasRecord: null,
    selectedAliasAiConfigured: false,
    replyContext: null,
    startAiGeneration: vi.fn(),
    markAiDraftReviewable: vi.fn(),
    approveAiDraft,
    discardAiDraft: vi.fn(),
    markAiDraftReprompting: vi.fn(),
    repromptAi: vi.fn(),
    cancelReprompt: vi.fn(),
    setAiError: vi.fn(),
    setComposerErrors: vi.fn(),
    startAiTransition: vi.fn(),
  });

  return {
    dispatch,
    approveAiDraft,
    controls,
  };
}

describe("useAiDraftRun", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies approval directly when the operator has not edited since insert", () => {
    const { dispatch, approveAiDraft, controls } = setup();

    controls.approveAi();

    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_AI_APPROVAL",
      approvedText: "AI draft",
    });
    expect(approveAiDraft).toHaveBeenCalledOnce();
  });

  it("requires confirmation before overwriting operator edits", () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal("window", { confirm });
    const { dispatch, approveAiDraft, controls } = setup({
      aiDraft: {
        ...baseAiDraft,
        status: "edited-after-generation",
      },
    });

    controls.approveAi();

    expect(confirm).toHaveBeenCalledWith(
      "Replace your current message with the AI draft?",
    );
    expect(dispatch).not.toHaveBeenCalledWith({
      type: "APPLY_AI_APPROVAL",
      approvedText: "AI draft",
    });
    expect(approveAiDraft).not.toHaveBeenCalled();
  });

  it("requires confirmation before approving a reviewable draft over typed body text", () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal("window", { confirm });
    const { dispatch, approveAiDraft, controls } = setup({
      body: "Operator typed this while reviewing the AI draft.",
      aiDraft: {
        ...baseAiDraft,
        status: "reviewable",
      },
    });

    controls.approveAi();

    expect(confirm).toHaveBeenCalledWith(
      "Replace your current message with the AI draft?",
    );
    expect(dispatch).not.toHaveBeenCalledWith({
      type: "APPLY_AI_APPROVAL",
      approvedText: "AI draft",
    });
    expect(approveAiDraft).not.toHaveBeenCalled();
  });
});
