import type { AiDraftStatus } from "../_components/inbox-client-provider";

export interface ResolveAiButtonStateInput {
  readonly body: string;
  readonly isGenerating: boolean;
  readonly aiDraftStatus?: AiDraftStatus;
}

export interface AiButtonState {
  readonly mode: "draft" | "fill";
  readonly label: string;
  readonly disabled: boolean;
}

export function resolveAiButtonState(
  input: ResolveAiButtonStateInput,
): AiButtonState {
  const status = input.aiDraftStatus ?? "idle";
  const mode =
    status === "idle" || status === "inserted"
      ? "draft"
      : input.body.trim().length === 0
        ? "draft"
        : "fill";

  return {
    mode,
    label:
      status === "idle" || status === "inserted"
        ? "Draft with AI"
        : mode === "draft"
          ? "Draft with AI"
          : "Fill with AI",
    disabled:
      input.isGenerating ||
      status === "generating" ||
      status === "reviewable" ||
      status === "reprompting",
  };
}
