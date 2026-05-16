import { cn } from "@/lib/utils";

export interface CampaignStateTab {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

export function StateFilterTabs({
  tabs,
  activeTabId,
  onSelect,
}: {
  readonly tabs: readonly CampaignStateTab[];
  readonly activeTabId: string;
  readonly onSelect: (tabId: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        return (
          <button
            key={tab.id}
            type="button"
            data-campaign-tab={tab.id}
            onClick={() => {
              onSelect(tab.id);
            }}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50",
            )}
          >
            <span className={isActive ? "font-semibold" : "font-medium"}>
              {tab.label}
            </span>
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
                isActive ? "bg-white/15 text-slate-100" : "bg-slate-100 text-slate-500",
              )}
            >
              {tab.count.toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
