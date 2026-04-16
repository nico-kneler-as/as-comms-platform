/**
 * Design Tokens — single source of truth for the AS Comms Platform UI.
 *
 * Every visual constant (color, typography, spacing, radius, shadow, animation,
 * layout) lives here. Components import from this file instead of hard-coding
 * Tailwind classes inline.
 *
 * All values are static strings so Tailwind's class scanner can detect them.
 */

// ─── Tone Colors ────────────────────────────────────────────────────────────
//
// Unified semantic palette. Each tone provides a consistent set of classes
// for backgrounds, text, rings/borders, and subtle (banner/area) variants.

export interface ToneClasses {
  /** Background — e.g. `bg-sky-50` */
  readonly bg: string;
  /** Foreground text — e.g. `text-sky-700` */
  readonly text: string;
  /** Ring / border accent — e.g. `ring-sky-200` */
  readonly ring: string;
  /** Subtle area background — e.g. `bg-sky-50/60` */
  readonly subtle: string;
}

export const TONE = {
  slate: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    ring: "ring-slate-200",
    subtle: "bg-slate-50/40",
  },
  sky: {
    bg: "bg-sky-50",
    text: "text-sky-700",
    ring: "ring-sky-200",
    subtle: "bg-sky-50/60",
  },
  indigo: {
    bg: "bg-indigo-50",
    text: "text-indigo-700",
    ring: "ring-indigo-200",
    subtle: "bg-indigo-50/60",
  },
  emerald: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    ring: "ring-emerald-200",
    subtle: "bg-emerald-50/60",
  },
  amber: {
    bg: "bg-amber-50",
    text: "text-amber-800",
    ring: "ring-amber-200",
    subtle: "bg-amber-50/60",
  },
  rose: {
    bg: "bg-rose-50",
    text: "text-rose-800",
    ring: "ring-rose-200",
    subtle: "bg-rose-50/60",
  },
  violet: {
    bg: "bg-violet-50",
    text: "text-violet-700",
    ring: "ring-violet-200",
    subtle: "bg-violet-50/40",
  },
  teal: {
    bg: "bg-teal-100",
    text: "text-teal-800",
    ring: "ring-teal-200",
    subtle: "bg-teal-50/60",
  },
} as const satisfies Record<string, ToneClasses>;

export type ToneName = keyof typeof TONE;

// ─── Avatar Tone Classes ────────────────────────────────────────────────────
//
// Pre-composed class strings for avatar backgrounds. Slightly different from
// the base tone (uses -100 bg, -800 text, -200 ring) to ensure legibility
// on the small circular surface.

export const AVATAR_TONE = {
  indigo: "bg-indigo-100 text-indigo-800 ring-indigo-200",
  emerald: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-100 text-amber-800 ring-amber-200",
  rose: "bg-rose-100 text-rose-800 ring-rose-200",
  sky: "bg-sky-100 text-sky-800 ring-sky-200",
  violet: "bg-violet-100 text-violet-800 ring-violet-200",
  teal: "bg-teal-100 text-teal-800 ring-teal-200",
  slate: "bg-slate-200 text-slate-700 ring-slate-300",
} as const;

// ─── Badge / Status Colors ──────────────────────────────────────────────────
//
// Pre-composed class strings for badge and status pill use-cases, grouped by
// domain so each component can pick the right map.

/** Inbox bucket badges (new / opened) */
export const BUCKET_BADGE = {
  new: "bg-sky-600 text-white border-transparent hover:bg-sky-600",
  opened: "bg-slate-200 text-slate-700 border-transparent hover:bg-slate-200",
} as const;

/** Volunteer lifecycle stage badges */
export const STAGE_BADGE = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200 border-transparent hover:bg-emerald-50",
  alumni: "bg-violet-50 text-violet-700 ring-violet-200 border-transparent hover:bg-violet-50",
  applicant: "bg-amber-50 text-amber-800 ring-amber-200 border-transparent hover:bg-amber-50",
  prospect: "bg-sky-50 text-sky-700 ring-sky-200 border-transparent hover:bg-sky-50",
  lead: "bg-indigo-50 text-indigo-700 ring-indigo-200 border-transparent hover:bg-indigo-50",
  "non-volunteer": "bg-slate-100 text-slate-700 ring-slate-200 border-transparent hover:bg-slate-100",
} as const;

/** Project participation status badges */
export const PROJECT_STATUS_BADGE = {
  lead: "bg-slate-100 text-slate-600",
  applied: "bg-sky-50 text-sky-700",
  "in-training": "bg-indigo-50 text-indigo-700",
  "trip-planning": "bg-amber-50 text-amber-700",
  "in-field": "bg-emerald-50 text-emerald-700",
  successful: "bg-violet-50 text-violet-700",
} as const;

/** Chip tone classes (neutral/info/warn/success) */
export const CHIP_TONE = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
} as const;

// ─── Typography ─────────────────────────────────────────────────────────────

export const TEXT = {
  /** Page / detail titles — `text-lg font-semibold text-slate-900` */
  headingLg: "text-lg font-semibold text-slate-900",
  /** Section / rail headers — `text-sm font-semibold text-slate-900` */
  headingSm: "text-sm font-semibold text-slate-900",
  /** Default body text — `text-sm text-slate-700` */
  bodyMd: "text-sm text-slate-700",
  /** Message body, descriptions — `text-[13px] leading-relaxed text-slate-700` */
  bodySm: "text-[13px] leading-relaxed text-slate-700",
  /** Secondary info, snippets — `text-xs text-slate-500` */
  caption: "text-xs text-slate-500",
  /** Section labels — `text-[10px] font-semibold uppercase tracking-wider text-slate-500` */
  label: "text-[10px] font-semibold uppercase tracking-wider text-slate-500",
  /** Timestamps, metadata — `text-[11px] text-slate-400` */
  micro: "text-[11px] text-slate-400",
  /** Badge text — `text-[10px] font-semibold uppercase tracking-wide` */
  badge: "text-[10px] font-semibold uppercase tracking-wide",
} as const;

// ─── Radius ─────────────────────────────────────────────────────────────────

export const RADIUS = {
  /** Inputs, small buttons — `rounded-md` */
  sm: "rounded-md",
  /** Cards, filter buttons, popovers — `rounded-lg` */
  md: "rounded-lg",
  /** Nav buttons, icon rail — `rounded-xl` */
  lg: "rounded-xl",
  /** Message bubbles — `rounded-2xl` */
  bubble: "rounded-2xl",
  /** Pills, avatars, badges — `rounded-full` */
  full: "rounded-full",
} as const;

// ─── Shadows ────────────────────────────────────────────────────────────────

export const SHADOW = {
  /** Buttons, inputs, cards, bubbles */
  sm: "shadow-sm",
  /** Popovers, dropdowns */
  md: "shadow-md",
} as const;

// ─── Transitions ────────────────────────────────────────────────────────────

export const TRANSITION = {
  /** Color transitions — `transition-colors duration-150` */
  fast: "transition-colors duration-150",
  /** Layout / dimension transitions — `transition-all duration-200 ease-out` */
  layout: "transition-all duration-200 ease-out",
  /** Accessibility — `motion-reduce:transition-none` */
  reduceMotion: "motion-reduce:transition-none",
} as const;

// ─── Layout ─────────────────────────────────────────────────────────────────

export const LAYOUT = {
  /** Shared header height for list, detail, and rail — `h-[65px]` */
  headerHeight: "h-[65px]",
  /** Inbox list column width — `w-[22rem]` */
  listWidth: "w-[22rem]",
  /** Contact rail width — `w-80` */
  railWidth: "w-80",
  /** Icon rail width — `w-14` */
  iconRailWidth: "w-14",
} as const;

// ─── Spacing (named padding combos) ─────────────────────────────────────────

export const SPACING = {
  /** List item padding — `px-5 py-3.5` */
  listItem: "px-5 py-3.5",
  /** Section padding — `px-5 py-4` */
  section: "px-5 py-4",
  /** Container padding — `px-6 py-6` */
  container: "px-6 py-6",
} as const;

// ─── Focus ring ─────────────────────────────────────────────────────────────

export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1" as const;
