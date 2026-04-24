import { describe, expect, it } from "vitest";

import { resolveAiButtonState } from "../../app/inbox/_components/inbox-composer";

describe("inbox composer AI button", () => {
  it('uses "Draft with AI" when the body is empty', () => {
    expect(
      resolveAiButtonState({
        body: "   ",
        isGenerating: false,
      }),
    ).toEqual({
      mode: "draft",
      label: "Draft with AI",
      disabled: false,
    });
  });

  it('uses "Fill with AI" when the body has content', () => {
    expect(
      resolveAiButtonState({
        body: "Turn this into a full reply",
        isGenerating: false,
      }),
    ).toEqual({
      mode: "fill",
      label: "Fill with AI",
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
});
