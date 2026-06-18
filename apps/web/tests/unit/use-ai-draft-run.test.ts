import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransitionStartFunction } from "react";

vi.mock("../../app/inbox/actions", () => ({
  draftWithAiAction: vi.fn(),
}));

import { useAiDraftRun } from "../../app/inbox/_hooks/use-ai-draft-run";
import type { AiDraftState } from "../../app/inbox/_components/inbox-client-provider";
import { INITIAL_COMPOSER_DRAFT_STATE } from "../../app/inbox/_hooks/composer-draft-reducer";

const baseAiDraft: AiDraftState = {
  status: "reviewable",
  channel: "email",
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
  readonly smsBody?: string;
  readonly aiDirective?: string;
  readonly activeTab?: "email" | "sms" | "note";
  readonly composerPaneMode?: "new-draft" | "replying" | "forwarding";
  readonly recipient?: (typeof INITIAL_COMPOSER_DRAFT_STATE)["recipient"];
  readonly smsRecipient?: (typeof INITIAL_COMPOSER_DRAFT_STATE)["smsRecipient"];
  readonly selectedAliasAiConfigured?: boolean;
  readonly startAiGeneration?: ReturnType<typeof vi.fn>;
  readonly startAiTransition?: TransitionStartFunction;
}) {
  const dispatch = vi.fn();
  const approveAiDraft = vi.fn();
  const editPromptAiDraft = vi.fn();
  const startAiGeneration = input?.startAiGeneration ?? vi.fn();
  const controls = useAiDraftRun({
    state: {
      ...INITIAL_COMPOSER_DRAFT_STATE,
      activeTab: input?.activeTab ?? "email",
      body: input?.body ?? "",
      smsBody: input?.smsBody ?? "",
      aiDirective: input?.aiDirective ?? "",
      recipient:
        input?.recipient ??
        ({
          kind: "contact",
          contactId: "contact-1",
          displayName: "Ada Lovelace",
          primaryEmail: "ada@example.org",
          primaryProjectName: "Forest",
          salesforceContactId: "sf-1",
        } as const),
      smsRecipient:
        input?.smsRecipient ??
        ({
          kind: "contact",
          contactId: "contact-sms-1",
          displayName: "Maya Lee",
          phoneE164: "+14065550123",
        } as const),
    },
    dispatch,
    aiDraft: input?.aiDraft ?? baseAiDraft,
    selectedAliasRecord: {
      id: "alias-1",
      alias: "forest@adventuresci.org",
      projectId: "project-1",
      projectName: "Forest",
      signature: "Best,\nForest Team",
      isAiReady: true,
      isAiConfigured: true,
      hasCachedContent: true,
    },
    selectedAliasAiConfigured: input?.selectedAliasAiConfigured ?? true,
    replyContext: {
      contactId: "contact-1",
      contactDisplayName: "Ada Lovelace",
      contactPrimaryPhone: "+14065550123",
      subject: "Re: Forest dates",
      threadCursor: "thread-cursor-1",
      threadId: "thread-1",
      inReplyToRfc822: "<message@example.org>",
      defaultAlias: "forest@adventuresci.org",
      cc: [],
    },
    composerPaneMode: input?.composerPaneMode ?? "replying",
    startAiGeneration,
    markAiDraftReviewable: vi.fn(),
    approveAiDraft,
    discardAiDraft: vi.fn(),
    editPromptAiDraft,
    markAiDraftReprompting: vi.fn(),
    repromptAi: vi.fn(),
    cancelReprompt: vi.fn(),
    setAiError: vi.fn(),
    setComposerErrors: vi.fn(),
    startAiTransition:
      input?.startAiTransition ??
      ((callback) => {
        void callback();
      }),
  });

  return {
    dispatch,
    approveAiDraft,
    editPromptAiDraft,
    startAiGeneration,
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
      channel: "email",
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
      channel: "email",
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
      channel: "email",
      approvedText: "AI draft",
    });
    expect(approveAiDraft).not.toHaveBeenCalled();
  });

  it("applies approval to sms without checking the email body", () => {
    const { dispatch, approveAiDraft, controls } = setup({
      activeTab: "sms",
      body: "Existing email draft",
      smsBody: "",
      aiDraft: {
        ...baseAiDraft,
        channel: "sms",
      },
    });

    controls.approveAi();

    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_AI_APPROVAL",
      channel: "sms",
      approvedText: "AI draft",
    });
    expect(approveAiDraft).toHaveBeenCalledOnce();
  });

  it("starts an sms AI draft with channel-aware request inputs", () => {
    const startAiGeneration = vi.fn();
    const startAiTransition = vi.fn();
    const { controls } = setup({
      activeTab: "sms",
      startAiGeneration,
      startAiTransition,
      recipient: null,
      smsRecipient: {
        kind: "contact",
        contactId: "contact-sms-42",
        displayName: "Maya Lee",
        phoneE164: "+14065550123",
      },
    });

    controls.runAiDraft();

    expect(startAiGeneration).toHaveBeenCalledWith({
      request: {
        contactId: "contact-sms-42",
        projectId: "project-1",
        intent: "reply",
        threadCursor: "thread-cursor-1",
        channel: "sms",
        mode: "draft",
      },
      prompt: "Draft with AI",
    });
    expect(startAiTransition).toHaveBeenCalledOnce();
  });

  it("runPolish dispatches a polish-mode request with operatorBody from state.body", () => {
    const startAiGeneration = vi.fn();
    const startAiTransition = vi.fn();
    const { controls } = setup({
      body: "thx for reaching out. i can send that shortly.",
      aiDirective: "more professional",
      startAiGeneration,
      startAiTransition,
    });

    controls.runPolish();

    expect(startAiGeneration).toHaveBeenCalledWith({
      request: {
        contactId: "contact-1",
        projectId: "project-1",
        intent: "reply",
        threadCursor: "thread-cursor-1",
        channel: "email",
        mode: "polish",
        operatorBody: "thx for reaching out. i can send that shortly.",
        operatorPrompt: "more professional",
      },
      prompt: "more professional",
    });
    expect(startAiTransition).toHaveBeenCalledOnce();
  });

  it("runPolish is a no-op when state.body is empty", () => {
    const startAiGeneration = vi.fn();
    const startAiTransition = vi.fn();
    const { controls } = setup({
      body: "   ",
      startAiGeneration,
      startAiTransition,
    });

    controls.runPolish();

    expect(startAiGeneration).not.toHaveBeenCalled();
    expect(startAiTransition).not.toHaveBeenCalled();
  });

  it("editPromptAi resets the aiDraft to idle but does not clear the composer's aiDirective", () => {
    const { dispatch, editPromptAiDraft, controls } = setup();

    controls.editPromptAi();

    expect(editPromptAiDraft).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalledWith({
      type: "SET_AI_DIRECTIVE",
      value: "",
    });
  });
});
