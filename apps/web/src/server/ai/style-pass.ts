import { applyAiTellCharacterSubstitutions } from "@as-comms/domain";

export interface StyleViolation {
  readonly category:
    | "em_dash"
    | "en_dash"
    | "curly_quote"
    | "stock_opener"
    | "filler_bridge"
    | "over_length";
  readonly detail: string;
  readonly autoFixed: boolean;
}

export interface StylePassResult {
  readonly text: string;
  readonly violations: readonly StyleViolation[];
}

const stockOpeners = [
  "Great question",
  "Good question",
  "Thanks for reaching out",
  "Thank you for reaching out",
  "Certainly",
  "Absolutely",
  "Of course",
  "I'd be happy to help",
  "I would be happy to help",
  "Happy to help",
] as const;

const fillerBridges = [
  "It is worth noting that",
  "It's worth noting that",
  "It is important to note",
  "It's important to note",
  "That said,",
  "With that in mind,",
  "In essence,",
  "Ultimately,",
] as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const leadingStockOpenerPattern = new RegExp(
  `^(?:${stockOpeners.map(escapeRegex).join("|")})[!.]\\s*`,
  "iu",
);
const fillerBridgePattern = new RegExp(
  fillerBridges.map(escapeRegex).join("|"),
  "giu",
);

function stripLeadingStockOpener(
  text: string,
  violations: StyleViolation[],
): string {
  const match = leadingStockOpenerPattern.exec(text);

  if (match === null) {
    return text;
  }

  const remainder = text.slice(match[0].length);

  if (remainder.trim().length === 0) {
    return text;
  }

  violations.push({
    category: "stock_opener",
    detail: match[0].trim(),
    autoFixed: true,
  });

  const firstCharacter = remainder[0];
  return firstCharacter !== undefined && /^[a-z]$/u.test(firstCharacter)
    ? `${firstCharacter.toUpperCase()}${remainder.slice(1)}`
    : remainder;
}

export function applyStylePass(
  draft: string,
  options: { readonly targetChars: number; readonly ceilingChars: number },
): StylePassResult {
  const characterPass = applyAiTellCharacterSubstitutions(draft);
  const violations: StyleViolation[] = characterPass.replacements.map(
    (replacement) => ({
      ...replacement,
      autoFixed: true,
    }),
  );
  // Trim the final text. The incoming draft is already trimmed, but dropping a
  // replacement comma at the very end of the draft leaves the whitespace that
  // preceded the dash behind, and `draft-generator` returns this string to the
  // operator verbatim. Internal newlines are untouched, so multi-paragraph
  // drafts keep their shape. Length is measured after the trim so the
  // over-length threshold reflects what the operator actually sees.
  const text = stripLeadingStockOpener(characterPass.text, violations).trim();

  for (const match of text.matchAll(fillerBridgePattern)) {
    violations.push({
      category: "filler_bridge",
      detail: match[0],
      autoFixed: false,
    });
  }

  if (text.length > options.ceilingChars) {
    violations.push({
      category: "over_length",
      detail: String(text.length),
      autoFixed: false,
    });
  }

  return { text, violations };
}
