import { describe, expect, it } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

Object.assign(globalThis, { React });

import { AboutThisDraftPanel } from "../../app/inbox/_components/about-this-draft";
import type { AiDraftState } from "../../app/inbox/_components/inbox-client-provider";

const aiDraft: AiDraftState = {
  status: "inserted",
  mode: "reprompt",
  responseMode: "generated",
  prompt: "Make it shorter",
  generatedText: "Hi Maya,\n\nHere is the updated field kit list.\n\nBest,",
  errorMessage: null,
  grounding: [
    {
      tier: 1,
      sourceProvider: "notion",
      sourceId: "voice-1",
      sourceUrl: "https://www.notion.so/voice-1",
      title: "General Training",
    },
  ],
  warnings: [
    {
      code: "grounding_empty",
      message: "Project-specific AI grounding is missing for this contact.",
    },
  ],
  costEstimateUsd: 0.0123,
  draftId: "8d4c5d25-8799-4b4d-9626-a6aa17a0ab18",
  repromptIndex: 1,
  repromptChain: [
    {
      direction: "Make it shorter",
      draft: "Shorter draft",
    },
  ],
  promptPreview: "[SYSTEM]\nVoice guidance",
  model: {
    name: "claude-sonnet-4-6",
    temperature: 0.3,
    maxTokens: 1200,
    inputTokens: 1200,
    outputTokens: 200,
    stopReason: "end_turn",
  },
  lastRequest: {
    contactId: "contact:maya",
    projectId: "project:whitebark",
    threadCursor: "event:inbound-1",
    repromptIndex: 1,
    mode: "reprompt",
    previousDraft: "Original draft",
    repromptDirection: "Make it shorter",
  },
};

describe("about this draft modal", () => {
  it("renders grounding sources, warnings, and cost details", () => {
    const markup = renderToStaticMarkup(
      createElement(AboutThisDraftPanel, {
        aiDraft,
      }),
    );

    // S5 redesign renames the section heading from "Grounding Sources" to "Sources".
    expect(markup).toContain("Sources");
    expect(markup).toContain("General Training");
    expect(markup).toContain("grounding_empty");
    expect(markup).toContain("$0.0123");
    expect(markup).toContain("Reprompt 1");
  });
});
