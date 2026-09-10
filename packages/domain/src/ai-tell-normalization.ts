export type AiTellCharacterCategory = "em_dash" | "en_dash" | "curly_quote";

export interface AiTellCharacterReplacement {
  readonly category: AiTellCharacterCategory;
  readonly detail: string;
}

export interface AiTellCharacterNormalizationResult {
  readonly text: string;
  readonly replacements: readonly AiTellCharacterReplacement[];
}

function collapseDashPunctuation(value: string): string {
  let collapsed = value;
  let previous: string;

  do {
    previous = collapsed;
    collapsed = collapsed
      .replace(/,,/gu, ",")
      .replace(/ ,/gu, ",")
      .replace(/,\./gu, ".");
  } while (collapsed !== previous);

  return collapsed.replace(/,(\s*\))/gu, "$1").replace(/,(\s*)$/gu, "$1");
}

/**
 * Applies the deterministic character-only AI-tell substitutions shared by
 * draft generation and the historical corpus normalization operation.
 */
export function applyAiTellCharacterSubstitutions(
  value: string,
): AiTellCharacterNormalizationResult {
  const replacements: AiTellCharacterReplacement[] = [];

  const numericRangesNormalized = value.replace(
    /(?<=\d)[—–](?=\d)/gu,
    (matched) => {
      replacements.push({
        category: matched === "—" ? "em_dash" : "en_dash",
        detail: matched,
      });
      return "-";
    },
  );

  // Consume the whitespace around the dash and emit exactly one comma plus one
  // space. Emitting a bare "," loses the following space in the unspaced forms
  // ("schedule—we", "policy -- long") — which is the shape models actually
  // produce — because the collapse pass below only repairs a *leading* space.
  // Absorbing the surrounding whitespace into the match is what makes all
  // three forms (spaced, unspaced, double-hyphen) land identically.
  const dashesNormalized = numericRangesNormalized.replace(
    /[ \t]*(—|–|--)[ \t]*/gu,
    (_matched: string, dash: string) => {
      replacements.push({
        category: dash === "–" ? "en_dash" : "em_dash",
        detail: dash,
      });
      return ", ";
    },
  );

  const quotesNormalized = dashesNormalized.replace(/[“”‘’]/gu, (matched) => {
    replacements.push({
      category: "curly_quote",
      detail: matched,
    });
    return matched === "“" || matched === "”" ? '"' : "'";
  });

  return {
    text: collapseDashPunctuation(quotesNormalized),
    replacements,
  };
}

export function normalizeAiTellCharacters(value: string): string {
  return applyAiTellCharacterSubstitutions(value).text;
}
