import type { ToneNameV2 } from "@/app/_lib/design-tokens-v2";

const PROJECT_TONE_PALETTE: readonly ToneNameV2[] = [
  "sky",
  "indigo",
  "emerald",
  "amber",
  "rose",
  "violet",
  "teal",
  "slate",
];

/**
 * Pure deterministic tone derived from a project name (or label, or any
 * stable string). Same input always returns the same tone — used so the
 * welcome screen, sidebar filter list, and inbox row badge agree on the
 * color for a given project until the view-model exposes a real `tone` field.
 */
export function projectToneFromName(name: string): ToneNameV2 {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PROJECT_TONE_PALETTE[hash % PROJECT_TONE_PALETTE.length] ?? "slate";
}
