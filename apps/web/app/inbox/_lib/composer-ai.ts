export interface ResolveAiButtonStateInput {
  readonly body: string;
  readonly isGenerating: boolean;
}

export interface AiButtonState {
  readonly mode: "draft" | "fill";
  readonly label: string;
  readonly disabled: boolean;
}

export function resolveAiButtonState(
  input: ResolveAiButtonStateInput,
): AiButtonState {
  const mode = input.body.trim().length === 0 ? "draft" : "fill";

  return {
    mode,
    label: mode === "draft" ? "Draft with AI" : "Fill with AI",
    disabled: input.isGenerating,
  };
}
