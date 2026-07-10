import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransitionStartFunction } from "react";

const draftWithAiAction = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    ok: true,
    data: {
      draft: "Generated draft",
      requestMode: "draft",
      mode: "generated",
      grounding: [],
      warnings: [],
      costEstimateUsd: 0,
      providerStatus: "ready",
      draftId: "11111111-1111-4111-8111-111111111111",
      repromptIndex: 0,
      promptPreview: "preview",
      model: {
        name: "claude-test",
        temperature: 0.2,
        maxTokens: 512,
        inputTokens: 12,
        outputTokens: 24,
        stopReason: "stop",
      },
    },
  }),
);

vi.mock("../../app/inbox/actions", () => ({
  draftWithAiAction,
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
  readonly selectedAliasRecord?: {
    readonly id: string;
    readonly alias: string;
    readonly projectId: string;
    readonly projectName: string;
    readonly signature: string;
    readonly isAiReady: boolean;
    readonly isAiConfigured: boolean;
    readonly hasCachedContent: boolean;
  } | null;
  readonly selectedAliasAiConfigured?: boolean;
  readonly smsAiConfigured?: boolean;
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
    selectedAliasRecord:
      input?.selectedAliasRecord === undefined
        ? {
            id: "alias-1",
            alias: "forest@adventuresci.org",
            projectId: "project-1",
            projectName: "Forest",
            signature: "Best,\nForest Team",
            isAiReady: true,
            isAiConfigured: true,
            hasCachedContent: true,
          }
        : input.selectedAliasRecord,
    selectedAliasAiConfigured: input?.selectedAliasAiConfigured ?? true,
    smsAiConfigured: input?.smsAiConfigured ?? true,
    replyContext: {
      contactId: "contact-1",
      contactDisplayName: "Ada Lovelace",
      contactPrimaryPhone: "+14065550123",
      defaultChannel: "email",
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

  it("starts an sms AI draft without a selected alias by sending a null project id", () => {
    const startAiGeneration = vi.fn();
    const { controls } = setup({
      activeTab: "sms",
      startAiGeneration,
      selectedAliasRecord: null,
      selectedAliasAiConfigured: false,
      smsAiConfigured: true,
    });

    controls.runAiDraft();

    expect(startAiGeneration).toHaveBeenCalledWith({
      request: {
        contactId: "contact-sms-1",
        projectId: null,
        intent: "reply",
        threadCursor: "thread-cursor-1",
        channel: "sms",
        mode: "draft",
      },
      prompt: "Draft with AI",
    });
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
