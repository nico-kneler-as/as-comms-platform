import {
  TONE,
  AVATAR_TONE,
  BUCKET_BADGE,
  STAGE_BADGE,
  PROJECT_STATUS_BADGE,
  CHIP_TONE,
  TEXT,
  RADIUS,
  SHADOW,
  SPACING,
  LAYOUT,
  TRANSITION,
  FOCUS_RING,
} from "@/app/_lib/design-tokens";
import { SectionLabel } from "@/components/ui/section-label";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Chip } from "@/components/ui/chip";
import { ToneAvatar } from "@/components/ui/tone-avatar";
import { DividerLabel } from "@/components/ui/divider-label";
import {
  InboxIcon,
  SearchIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  MailIcon,
} from "lucide-react";

export const metadata = {
  title: "Design System",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function TokenRow({
  name,
  value,
  children,
}: {
  name: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="w-48 shrink-0">{children}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">{name}</p>
        <p className="mt-0.5 truncate font-mono text-xs text-slate-500">
          {value}
        </p>
      </div>
    </div>
  );
}

function CatalogSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

// ─── Navigation ─────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: "colors", label: "Colors" },
  { id: "avatars", label: "Avatars" },
  { id: "typography", label: "Typography" },
  { id: "radius", label: "Radius" },
  { id: "shadows", label: "Shadows" },
  { id: "spacing", label: "Spacing" },
  { id: "layout", label: "Layout" },
  { id: "transitions", label: "Transitions" },
  { id: "section-label", label: "SectionLabel" },
  { id: "status-badge", label: "StatusBadge" },
  { id: "chip", label: "Chip" },
  { id: "tone-avatar", label: "ToneAvatar" },
  { id: "empty-state", label: "EmptyState" },
  { id: "divider-label", label: "DividerLabel" },
];

// ─── Page ───────────────────────────────────────────────────────────────────

export default function DesignSystemPage() {
  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar nav */}
      <nav className="sticky top-0 flex h-screen w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-slate-200 bg-white px-3 py-6">
        <p className="mb-4 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Design System
        </p>
        {NAV_ITEMS.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="rounded-md px-2 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            {item.label}
          </a>
        ))}
      </nav>

      {/* Content */}
      <main className="min-w-0 flex-1 px-10 py-10">
        <h1 className="text-3xl font-bold text-slate-900">
          AS Comms Design System
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          Tokens, primitives, and component catalog. All values are sourced from{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
            design-tokens.ts
          </code>{" "}
          and rendered as static Tailwind class strings.
        </p>

        <div className="mt-12 flex flex-col gap-16">
          {/* ── Colors ──────────────────────────────────────────────── */}
          <CatalogSection
            id="colors"
            title="Colors"
            description="Semantic tone palette. Each tone provides bg, text, ring, and subtle variants."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(TONE) as (keyof typeof TONE)[]).map((name) => {
                const t = TONE[name];
                return (
                  <div
                    key={name}
                    className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="text-sm font-semibold capitalize text-slate-900">
                        {name}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 divide-x divide-slate-100 border-t border-slate-100">
                      <SwatchCell label="bg" classes={t.bg} />
                      <SwatchCell label="text" classes={t.text} textSwatch />
                      <SwatchCell label="ring" classes={t.ring.replace("ring-", "bg-")} />
                      <SwatchCell label="subtle" classes={t.subtle} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CatalogSection>

          {/* ── Avatars ─────────────────────────────────────────────── */}
          <CatalogSection
            id="avatars"
            title="Avatar Tones"
            description="Pre-composed avatar background classes for initials."
          >
            <div className="flex flex-wrap gap-3">
              {(Object.keys(AVATAR_TONE) as (keyof typeof AVATAR_TONE)[]).map(
                (tone) => (
                  <div key={tone} className="flex flex-col items-center gap-2">
                    <ToneAvatar
                      initials={tone.slice(0, 2).toUpperCase()}
                      tone={tone}
                      size="lg"
                    />
                    <span className="text-xs text-slate-500">{tone}</span>
                  </div>
                ),
              )}
            </div>
            <div className="mt-6">
              <p className="mb-3 text-sm font-medium text-slate-700">Sizes</p>
              <div className="flex items-end gap-4">
                {(["sm", "md", "lg"] as const).map((size) => (
                  <div key={size} className="flex flex-col items-center gap-2">
                    <ToneAvatar initials="AS" tone="indigo" size={size} />
                    <span className="text-xs text-slate-500">{size}</span>
                  </div>
                ))}
              </div>
            </div>
          </CatalogSection>

          {/* ── Typography ──────────────────────────────────────────── */}
          <CatalogSection
            id="typography"
            title="Typography"
            description="Pre-composed text class combos for consistent hierarchy."
          >
            <div className="flex flex-col gap-3">
              {(
                Object.entries(TEXT) as [keyof typeof TEXT, string][]
              ).map(([name, classes]) => (
                <TokenRow key={name} name={name} value={classes}>
                  <span className={classes}>
                    {name === "label"
                      ? "SECTION LABEL"
                      : name === "badge"
                        ? "BADGE TEXT"
                        : "The quick brown fox"}
                  </span>
                </TokenRow>
              ))}
            </div>
          </CatalogSection>

          {/* ── Radius ──────────────────────────────────────────────── */}
          <CatalogSection
            id="radius"
            title="Radius"
            description="Border radius scale."
          >
            <div className="flex flex-wrap gap-4">
              {(
                Object.entries(RADIUS) as [keyof typeof RADIUS, string][]
              ).map(([name, classes]) => (
                <div key={name} className="flex flex-col items-center gap-2">
                  <div
                    className={`flex h-16 w-16 items-center justify-center border-2 border-slate-300 bg-slate-100 ${classes}`}
                  />
                  <span className="text-xs font-medium text-slate-700">
                    {name}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {classes}
                  </span>
                </div>
              ))}
            </div>
          </CatalogSection>

          {/* ── Shadows ─────────────────────────────────────────────── */}
          <CatalogSection
            id="shadows"
            title="Shadows"
            description="Shadow elevation levels."
          >
            <div className="flex gap-6">
              {(
                Object.entries(SHADOW) as [keyof typeof SHADOW, string][]
              ).map(([name, classes]) => (
                <div key={name} className="flex flex-col items-center gap-2">
                  <div
                    className={`flex h-20 w-32 items-center justify-center rounded-lg border border-slate-200 bg-white ${classes}`}
                  >
                    <span className="text-sm text-slate-500">{name}</span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400">
                    {classes}
                  </span>
                </div>
              ))}
            </div>
          </CatalogSection>

          {/* ── Spacing ─────────────────────────────────────────────── */}
          <CatalogSection
            id="spacing"
            title="Spacing"
            description="Named padding combinations for consistent component spacing."
          >
            <div className="flex flex-col gap-3">
              {(
                Object.entries(SPACING) as [keyof typeof SPACING, string][]
              ).map(([name, classes]) => (
                <TokenRow key={name} name={name} value={classes}>
                  <div className={`border border-dashed border-sky-300 bg-sky-50 ${classes}`}>
                    <div className="h-4 rounded bg-sky-200" />
                  </div>
                </TokenRow>
              ))}
            </div>
          </CatalogSection>

          {/* ── Layout ──────────────────────────────────────────────── */}
          <CatalogSection
            id="layout"
            title="Layout"
            description="Fixed dimension tokens for the app shell."
          >
            <div className="flex flex-col gap-3">
              {(
                Object.entries(LAYOUT) as [keyof typeof LAYOUT, string][]
              ).map(([name, classes]) => (
                <TokenRow key={name} name={name} value={classes}>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                    {classes}
                  </code>
                </TokenRow>
              ))}
              <TokenRow name="FOCUS_RING" value={FOCUS_RING}>
                <button
                  type="button"
                  className={`rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 ${FOCUS_RING}`}
                >
                  Focus me
                </button>
              </TokenRow>
            </div>
          </CatalogSection>

          {/* ── Transitions ─────────────────────────────────────────── */}
          <CatalogSection
            id="transitions"
            title="Transitions"
            description="Animation presets for color and layout transitions."
          >
            <div className="flex flex-col gap-3">
              {(
                Object.entries(TRANSITION) as [
                  keyof typeof TRANSITION,
                  string,
                ][]
              ).map(([name, classes]) => (
                <TokenRow key={name} name={name} value={classes}>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                    {classes}
                  </code>
                </TokenRow>
              ))}
            </div>
          </CatalogSection>

          {/* ── SectionLabel Component ──────────────────────────────── */}
          <CatalogSection
            id="section-label"
            title="SectionLabel"
            description="Uppercase section header for grouping content."
          >
            <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6">
              <div>
                <SectionLabel>Default (h3)</SectionLabel>
                <p className="mt-1 text-sm text-slate-500">
                  Content below the label
                </p>
              </div>
              <div>
                <SectionLabel as="h2">As h2</SectionLabel>
              </div>
              <div>
                <SectionLabel as="p">As paragraph</SectionLabel>
              </div>
            </div>
            <CodeBlock>
              {`<SectionLabel>Contact</SectionLabel>\n<SectionLabel as="p">Projects</SectionLabel>`}
            </CodeBlock>
          </CatalogSection>

          {/* ── StatusBadge Component ───────────────────────────────── */}
          <CatalogSection
            id="status-badge"
            title="StatusBadge"
            description="Semantic status pill with three variants: filled, soft, and subtle."
          >
            <div className="space-y-6 rounded-lg border border-slate-200 bg-white p-6">
              <div>
                <p className="mb-3 text-sm font-medium text-slate-700">
                  Filled (inbox buckets)
                </p>
                <div className="flex gap-2">
                  {(
                    Object.entries(BUCKET_BADGE) as [string, string][]
                  ).map(([key, classes]) => (
                    <StatusBadge
                      key={key}
                      variant="filled"
                      colorClasses={classes}
                      label={key.charAt(0).toUpperCase() + key.slice(1)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-3 text-sm font-medium text-slate-700">
                  Soft (volunteer stages)
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    Object.entries(STAGE_BADGE) as [string, string][]
                  ).map(([key, classes]) => (
                    <StatusBadge
                      key={key}
                      variant="soft"
                      colorClasses={classes}
                      label={key.charAt(0).toUpperCase() + key.slice(1)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-3 text-sm font-medium text-slate-700">
                  Subtle (project status)
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    Object.entries(PROJECT_STATUS_BADGE) as [
                      string,
                      string,
                    ][]
                  ).map(([key, classes]) => (
                    <StatusBadge
                      key={key}
                      variant="subtle"
                      colorClasses={classes}
                      label={key
                        .split("-")
                        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(" ")}
                    />
                  ))}
                </div>
              </div>
            </div>
            <CodeBlock>
              {`<StatusBadge variant="filled" colorClasses={BUCKET_BADGE.new} label="New" />\n<StatusBadge variant="soft" colorClasses={STAGE_BADGE.active} label="Active" />\n<StatusBadge variant="subtle" colorClasses={PROJECT_STATUS_BADGE.applied} label="Applied" />`}
            </CodeBlock>
          </CatalogSection>

          {/* ── Chip Component ──────────────────────────────────────── */}
          <CatalogSection
            id="chip"
            title="Chip"
            description="Compact inline semantic tag with optional icon."
          >
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
              <div>
                <p className="mb-3 text-sm font-medium text-slate-700">
                  Tones
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    Object.keys(CHIP_TONE) as (keyof typeof CHIP_TONE)[]
                  ).map((tone) => (
                    <Chip key={tone} tone={tone}>
                      {tone}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-3 text-sm font-medium text-slate-700">
                  With icon
                </p>
                <div className="flex flex-wrap gap-2">
                  <Chip
                    tone="info"
                    icon={<MailIcon className="h-3 w-3" />}
                  >
                    Email
                  </Chip>
                  <Chip
                    tone="success"
                    icon={<CheckCircleIcon className="h-3 w-3" />}
                  >
                    Verified
                  </Chip>
                  <Chip
                    tone="warn"
                    icon={<AlertTriangleIcon className="h-3 w-3" />}
                  >
                    Pending
                  </Chip>
                </div>
              </div>
            </div>
            <CodeBlock>
              {`<Chip tone="info" icon={<MailIcon />}>Email</Chip>\n<Chip tone="success">Verified</Chip>`}
            </CodeBlock>
          </CatalogSection>

          {/* ── ToneAvatar Component ────────────────────────────────── */}
          <CatalogSection
            id="tone-avatar"
            title="ToneAvatar"
            description="Circular avatar with colored background and initials."
          >
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
              <div>
                <p className="mb-3 text-sm font-medium text-slate-700">
                  All tones (size md)
                </p>
                <div className="flex flex-wrap gap-3">
                  {(
                    Object.keys(AVATAR_TONE) as (keyof typeof AVATAR_TONE)[]
                  ).map((tone) => (
                    <ToneAvatar
                      key={tone}
                      initials={tone.slice(0, 2).toUpperCase()}
                      tone={tone}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-3 text-sm font-medium text-slate-700">
                  Size scale
                </p>
                <div className="flex items-end gap-4">
                  <ToneAvatar initials="SM" tone="sky" size="sm" />
                  <ToneAvatar initials="MD" tone="sky" size="md" />
                  <ToneAvatar initials="LG" tone="sky" size="lg" />
                </div>
              </div>
            </div>
            <CodeBlock>
              {`<ToneAvatar initials="MP" tone="indigo" size="md" />`}
            </CodeBlock>
          </CatalogSection>

          {/* ── EmptyState Component ────────────────────────────────── */}
          <CatalogSection
            id="empty-state"
            title="EmptyState"
            description="Icon + title + description for empty/no-data contexts."
          >
            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white">
                <p className="border-b border-slate-100 px-4 py-2 text-xs font-medium text-slate-500">
                  size=&quot;sm&quot; (default)
                </p>
                <EmptyState
                  icon={<InboxIcon className="h-6 w-6" />}
                  title="All caught up"
                  description="No conversations match the current filter."
                />
              </div>
              <div className="rounded-lg border border-slate-200 bg-white">
                <p className="border-b border-slate-100 px-4 py-2 text-xs font-medium text-slate-500">
                  size=&quot;sm&quot; with search
                </p>
                <EmptyState
                  icon={<SearchIcon className="h-6 w-6" />}
                  title="No results"
                  description={
                    <>
                      Nothing matches &ldquo;test query&rdquo;. Try a different
                      search.
                    </>
                  }
                />
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-slate-200 bg-white">
              <p className="border-b border-slate-100 px-4 py-2 text-xs font-medium text-slate-500">
                size=&quot;lg&quot; (full page)
              </p>
              <div className="h-64">
                <EmptyState
                  size="lg"
                  icon={<InboxIcon className="h-7 w-7" />}
                  title="Select a person to begin"
                  description="Choose anyone to see their full communication history."
                />
              </div>
            </div>
            <CodeBlock>
              {`<EmptyState\n  icon={<InboxIcon className="h-6 w-6" />}\n  title="All caught up"\n  description="No conversations match the current filter."\n/>\n\n<EmptyState\n  size="lg"\n  icon={<InboxIcon className="h-7 w-7" />}\n  title="Select a person"\n  description="Choose anyone to view their history."\n/>`}
            </CodeBlock>
          </CatalogSection>

          {/* ── DividerLabel Component ──────────────────────────────── */}
          <CatalogSection
            id="divider-label"
            title="DividerLabel"
            description="Centered text divider for separating timeline sections."
          >
            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
              <DividerLabel>Maya signed up for Tracking Whitebark Pine 2026</DividerLabel>
              <DividerLabel>Stage changed to Active</DividerLabel>
              <DividerLabel>3 weeks ago</DividerLabel>
            </div>
            <CodeBlock>
              {`<DividerLabel>Maya signed up for Tracking Whitebark Pine</DividerLabel>`}
            </CodeBlock>
          </CatalogSection>
        </div>
      </main>
    </div>
  );
}

// ─── Swatch cell for color grid ─────────────────────────────────────────────

function SwatchCell({
  label,
  classes,
  textSwatch = false,
}: {
  label: string;
  classes: string;
  textSwatch?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-2 py-3">
      {textSwatch ? (
        <span className={`text-lg font-bold ${classes}`}>Aa</span>
      ) : (
        <div className={`h-8 w-8 rounded-md ${classes}`} />
      )}
      <span className="text-[10px] text-slate-500">{label}</span>
    </div>
  );
}

// ─── Code block ─────────────────────────────────────────────────────────────

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-4 text-xs leading-5 text-slate-300">
      <code>{children}</code>
    </pre>
  );
}
