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
    <div className="flex flex-wrap gap-1 rounded-lg bg-transparent p-0">
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
              "inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-[12.5px] transition-colors",
              isActive
                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                : "text-slate-600 hover:bg-white/70",
            )}
          >
            <span className={isActive ? "font-semibold" : "font-medium"}>
              {tab.label}
            </span>
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10.5px] tabular-nums",
                isActive ? "bg-slate-100 text-slate-500" : "text-slate-400",
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
