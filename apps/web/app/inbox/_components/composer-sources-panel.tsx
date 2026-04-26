"use client";

import type { AiDraftState } from "./inbox-client-provider";

const TIER_TITLES = {
  1: "Voice & Style",
  2: "Project context",
  3: "Knowledge",
  4: "Recent thread",
} as const;

type TierKey = keyof typeof TIER_TITLES;

interface SourcePanelSection {
  readonly tier: TierKey;
  readonly title: string;
  readonly items: readonly string[];
  readonly placeholder?: boolean;
}

function buildSourceSections(
  sources: AiDraftState["grounding"],
): readonly SourcePanelSection[] {
  if (sources.length === 0) {
    return [
      { tier: 1, title: TIER_TITLES[1], items: ["Coming soon"], placeholder: true },
      { tier: 2, title: TIER_TITLES[2], items: ["Coming soon"], placeholder: true },
      { tier: 3, title: TIER_TITLES[3], items: ["Coming soon"], placeholder: true },
      { tier: 4, title: TIER_TITLES[4], items: ["Coming soon"], placeholder: true },
    ];
  }

  return ([1, 2, 3, 4] as const).map((tier) => {
    const items = sources
      .filter((source) => source.tier === tier)
      .map((source) => source.title ?? source.sourceId);

    return {
      tier,
      title: TIER_TITLES[tier],
      items: items.length > 0 ? items : ["Coming soon"],
      placeholder: items.length === 0,
    };
  });
}

function resolveTierBadgeClass(tier: TierKey): string {
  switch (tier) {
    case 1:
      return "bg-slate-100 text-slate-700";
    case 2:
      return "bg-sky-100 text-sky-700";
    case 3:
      return "bg-violet-100 text-violet-700";
    case 4:
      return "bg-emerald-100 text-emerald-700";
  }
}

export function ComposerSourcesPanel({
  sources,
}: {
  readonly sources: AiDraftState["grounding"];
}) {
  const sections = buildSourceSections(sources);

  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <section key={section.tier} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${resolveTierBadgeClass(section.tier)}`}
            >
              Tier {section.tier}
            </span>
            <h3 className="text-sm font-medium text-slate-900">
              {section.title}
            </h3>
          </div>
          <ul className="space-y-1 text-sm text-slate-700">
            {section.items.map((item) => (
              <li
                key={`${String(section.tier)}:${item}`}
                className={section.placeholder ? "italic text-slate-500" : ""}
              >
                {item}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
