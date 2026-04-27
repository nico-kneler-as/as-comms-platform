import { describe, expect, it } from "vitest";

import { resolveAiButtonState } from "../../app/inbox/_lib/composer-ai";

describe("inbox composer AI button", () => {
  it('uses "Draft with AI" when the body is empty', () => {
    expect(
      resolveAiButtonState({
        body: "   ",
        isGenerating: false,
        aiDraftStatus: "idle",
      }),
    ).toEqual({
      mode: "draft",
      label: "Draft with AI",
      disabled: false,
    });
  });

  it('uses "Draft with AI" while idle even when the body has content', () => {
    expect(
      resolveAiButtonState({
        body: "Turn this into a full reply",
        isGenerating: false,
      }),
    ).toEqual({
      mode: "draft",
      label: "Draft with AI",
      disabled: false,
    });
  });

  it("disables the button while AI generation is active", () => {
    expect(
      resolveAiButtonState({
        body: "",
        isGenerating: true,
      }),
    ).toEqual({
      mode: "draft",
      label: "Draft with AI",
      disabled: true,
    });
  });

  it('shows "Draft with AI" after approval even when the body has content', () => {
    expect(
      resolveAiButtonState({
        body: "Approved generated text",
        isGenerating: false,
        aiDraftStatus: "inserted",
      }),
    ).toEqual({
      mode: "draft",
      label: "Draft with AI",
      disabled: false,
    });
  });

  it("disables the footer button while an AI preview is active", () => {
    expect(
      resolveAiButtonState({
        body: "",
        isGenerating: false,
        aiDraftStatus: "reviewable",
      }),
    ).toEqual({
      mode: "draft",
      label: "Draft with AI",
      disabled: true,
    });
  });
});
