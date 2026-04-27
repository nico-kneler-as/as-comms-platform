/**
 * Design Tokens v2 — single source of truth aligned with the Claude Design v2
 * handoff (2026-04-25). Companion to (and eventual replacement for) the
 * legacy `design-tokens.ts`.
 *
 * ## Migration plan
 *
 * - **New code uses this file.** Components touched during the pixel-perfect
 *   pass migrate from `design-tokens.ts` → `design-tokens-v2.ts` as they ship.
 * - **Untouched components keep using v1 unchanged** until their surface is
 *   rebuilt. v1 stays in place; nothing is breaking-changed.
 * - When no callers of v1 remain, v1 is deleted. Track via grep for
 *   `from "@/app/_lib/design-tokens"` (v1 path) vs `design-tokens-v2`.
 *
 * ## Why a parallel file
 *
 * The v1 `TONE.X.bg` returns the **light** background (e.g. `bg-sky-50`).
 * The design's `TONE_CLASSES.X.bg` returns the **solid** background
 * (e.g. `bg-sky-600`). Same key, opposite intent. Importing v2 instead of v1
 * is the explicit signal that the new semantics apply.
 *
 * ## Key shape (matches design's `primitives.jsx`)
 *
 * Each tone exposes 7 keys:
 *  - `bg`         — solid background  (e.g. `bg-sky-600`)
 *  - `text`       — text on light/neutral surfaces  (e.g. `text-sky-700`)
 *  - `ring`       — ring or border accent  (e.g. `ring-sky-200`)
 *  - `subtle`     — subtle fill  (e.g. `bg-sky-50`)
 *  - `subtleText` — text inside subtle fill  (e.g. `text-sky-700`)
 *  - `avatar`     — pre-composed avatar classes  (`bg-sky-100 text-sky-700`)
 *  - `dot`        — small color dot  (`bg-sky-500`)
 *
 * All values are static strings so Tailwind's class scanner can detect them.
 */

// ─── Tone Classes ─────────────────────────────────────────────────────────

export interface ToneClassesV2 {
  /** Solid background — e.g. `bg-sky-600` */
  readonly bg: string;
  /** Text on light/neutral surfaces — e.g. `text-sky-700` */
  readonly text: string;
  /** Ring / border accent — e.g. `ring-sky-200` */
  readonly ring: string;
  /** Subtle fill — e.g. `bg-sky-50` */
  readonly subtle: string;
  /** Text inside subtle fills — e.g. `text-sky-700` */
  readonly subtleText: string;
  /** Pre-composed avatar background + text — e.g. `bg-sky-100 text-sky-700` */
  readonly avatar: string;
  /** Color dot — e.g. `bg-sky-500` */
  readonly dot: string;
}

export const TONE_CLASSES = {
  slate: {
    bg: "bg-slate-600",
    text: "text-slate-700",
    ring: "ring-slate-200",
    subtle: "bg-slate-50",
    subtleText: "text-slate-700",
    avatar: "bg-slate-100 text-slate-700",
    dot: "bg-slate-400",
  },
  sky: {
    bg: "bg-sky-600",
    text: "text-sky-700",
    ring: "ring-sky-200",
    subtle: "bg-sky-50",
    subtleText: "text-sky-700",
    avatar: "bg-sky-100 text-sky-700",
    dot: "bg-sky-500",
  },
  indigo: {
    bg: "bg-indigo-600",
    text: "text-indigo-700",
    ring: "ring-indigo-200",
    subtle: "bg-indigo-50",
    subtleText: "text-indigo-700",
    avatar: "bg-indigo-100 text-indigo-700",
    dot: "bg-indigo-500",
  },
  emerald: {
    bg: "bg-emerald-600",
    text: "text-emerald-700",
    ring: "ring-emerald-200",
    subtle: "bg-emerald-50",
    subtleText: "text-emerald-700",
    avatar: "bg-emerald-100 text-emerald-700",
    dot: "bg-emerald-500",
  },
  amber: {
    bg: "bg-amber-500",
    text: "text-amber-700",
    ring: "ring-amber-200",
    subtle: "bg-amber-50",
    subtleText: "text-amber-700",
    avatar: "bg-amber-100 text-amber-700",
    dot: "bg-amber-500",
  },
  rose: {
    bg: "bg-rose-500",
    text: "text-rose-700",
    ring: "ring-rose-200",
    subtle: "bg-rose-50",
    subtleText: "text-rose-700",
    avatar: "bg-rose-100 text-rose-700",
    dot: "bg-rose-500",
  },
  violet: {
    bg: "bg-violet-500",
    text: "text-violet-700",
    ring: "ring-violet-200",
    subtle: "bg-violet-50",
    subtleText: "text-violet-700",
    avatar: "bg-violet-100 text-violet-700",
    dot: "bg-violet-500",
  },
  teal: {
    bg: "bg-teal-600",
    text: "text-teal-700",
    ring: "ring-teal-200",
    subtle: "bg-teal-50",
    subtleText: "text-teal-700",
    avatar: "bg-teal-100 text-teal-700",
    dot: "bg-teal-500",
  },
} as const satisfies Record<string, ToneClassesV2>;

export type ToneNameV2 = keyof typeof TONE_CLASSES;

// ─── Typography ───────────────────────────────────────────────────────────
//
// Mirrors design's `TYPE` map verbatim. The legacy `TEXT` map in v1 has a
// `bodySerifSm` token that the design didn't anticipate; it's kept under
// the same name here so message-body serif rendering keeps working.

export const TYPE = {
  /** Page / detail titles — `text-lg font-semibold text-slate-900` */
  headingLg: "text-lg font-semibold text-slate-900",
  /** Modal / panel titles — `text-base font-semibold text-slate-900` */
  headingMd: "text-base font-semibold text-slate-900",
  /** Section / rail headers — `text-sm font-semibold text-slate-900` */
  headingSm: "text-sm font-semibold text-slate-900",
  /** Default body text — `text-sm text-slate-700` */
  bodyMd: "text-sm text-slate-700",
  /** Message body, descriptions — `text-[13px] leading-relaxed text-slate-700` */
  bodySm: "text-[13px] leading-relaxed text-slate-700",
  /** Long-form message body — Source Serif 4, slightly larger for reading */
  bodySerifSm: "text-[13.5px] leading-relaxed text-slate-700",
  /** Secondary info, snippets — `text-xs text-slate-500` */
  caption: "text-xs text-slate-500",
  /** Section labels — `text-[10px] font-semibold uppercase tracking-wider text-slate-500` */
  label: "text-[10px] font-semibold uppercase tracking-wider text-slate-500",
  /** Timestamps, metadata — `text-[11px] text-slate-400` */
  micro: "text-[11px] text-slate-400",
  /** Badge text — `text-[10px] font-semibold uppercase tracking-wide` */
  badge: "text-[10px] font-semibold uppercase tracking-wide",
} as const;

// ─── Layout / Spacing / Radius / Shadow / Transitions / Focus ─────────────
//
// These tokens are missing from design's `primitives.jsx` (the design files
// hard-code them inline). Production shipped them in v1 and they're worth
// keeping — they're cross-component truths that absolutely belong in a
// tokens file.

export const RADIUS = {
  /** Inputs, small buttons */
  sm: "rounded-md",
  /** Cards, filter buttons, popovers */
  md: "rounded-lg",
  /** Nav buttons, icon rail */
  lg: "rounded-xl",
  /** Message bubbles */
  bubble: "rounded-2xl",
  /** Pills, avatars, badges */
  full: "rounded-full",
} as const;

export const SHADOW = {
  /** Buttons, inputs, cards, bubbles */
  sm: "shadow-sm",
  /** Popovers, dropdowns */
  md: "shadow-md",
} as const;

export const TRANSITION = {
  fast: "transition-colors duration-150",
  layout: "transition-all duration-200 ease-out",
  reduceMotion: "motion-reduce:transition-none",
} as const;

export const LAYOUT = {
  /** Shared header height for list, detail, and rail */
  headerHeight: "h-[65px]",
  /** Inbox list column width */
  listWidth: "w-[22rem]",
  /** Contact rail width */
  railWidth: "w-80",
  /** Icon rail width */
  iconRailWidth: "w-14",
} as const;

export const SPACING = {
  listItem: "px-5 py-3.5",
  section: "px-5 py-4",
  container: "px-6 py-6",
} as const;

export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1" as const;
