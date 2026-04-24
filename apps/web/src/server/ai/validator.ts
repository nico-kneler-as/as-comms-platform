import type { GroundingBundle } from "./types";

const TRAINING_PLACEHOLDER_PATTERN = /\{(?:NAME|EMAIL|PHONE|PROJECT)\}/u;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function tokenize(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/giu, " ")
    .split(/\s+/u)
    .filter((token) => token.length > 0);
}

function longestCommonTokenRun(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const matrix = Array.from({ length: right.length + 1 }, () =>
    Array<number>(left.length + 1).fill(0),
  );
  let longest = 0;

  for (let row = 1; row <= right.length; row += 1) {
    const currentRow = matrix[row];
    const previousRow = matrix[row - 1];
    if (!currentRow || !previousRow) continue;
    for (let column = 1; column <= left.length; column += 1) {
      if (right[row - 1] !== left[column - 1]) {
        currentRow[column] = 0;
        continue;
      }

      const nextLength = (previousRow[column - 1] ?? 0) + 1;
      currentRow[column] = nextLength;
      longest = Math.max(longest, nextLength);
    }
  }

  return longest;
}

export function validateDraft(
  draft: string,
  bundle: GroundingBundle,
): {
  readonly ok: boolean;
  readonly reasons: readonly string[];
} {
  const reasons: string[] = [];
  const normalizedDraft = normalizeWhitespace(draft);

  if (normalizedDraft.length === 0) {
    reasons.push("Draft output was empty.");
  }

  if (TRAINING_PLACEHOLDER_PATTERN.test(draft)) {
    reasons.push("Draft output still contains training placeholders.");
  }

  const tierOneContent = bundle.generalTraining?.content ?? "";
  const draftTokens = tokenize(draft);
  const tierOneTokens = tokenize(tierOneContent);

  if (draftTokens.length > 0 && tierOneTokens.length > 0) {
    const overlapRatio =
      longestCommonTokenRun(draftTokens, tierOneTokens) / draftTokens.length;

    if (overlapRatio > 0.5) {
      reasons.push("Draft output echoes the tier-1 voice guidance too closely.");
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

