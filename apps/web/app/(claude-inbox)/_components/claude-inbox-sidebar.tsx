import type { ClaudeInboxFilterViewModel } from "../_lib/view-models.js";
import { AlertIcon, InboxIcon, StarIcon, UsersIcon } from "./claude-icons.js";

interface SidebarProps {
  readonly filters: readonly ClaudeInboxFilterViewModel[];
  readonly activeFilterId: string;
}

const ICONS = {
  new: InboxIcon,
  opened: InboxIcon,
  starred: StarIcon,
  unresolved: AlertIcon,
  all: UsersIcon
} as const;

export function ClaudeInboxSidebar({ filters, activeFilterId }: SidebarProps) {
  return (
    <aside
      className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-50/60"
      aria-label="Inbox filters"
    >
      <div className="flex items-center justify-between px-5 pt-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Inbox
        </p>
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
          Claude prototype
        </span>
      </div>
      <div className="px-3 pb-3 pt-4">
        <ul className="space-y-0.5">
          {filters.map((f) => {
            const Icon = ICONS[f.id];
            const isActive = f.id === activeFilterId;
            return (
              <li key={f.id}>
                <button
                  type="button"
                  aria-pressed={isActive}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition ${
                    isActive
                      ? "bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200"
                      : "text-slate-600 hover:bg-white/80 hover:text-slate-900"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{f.label}</span>
                  <span
                    className={`text-xs tabular-nums ${
                      isActive ? "text-slate-900" : "text-slate-400"
                    }`}
                  >
                    {f.count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-2 border-t border-slate-200 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Projects
        </p>
        <ul className="mt-3 space-y-1 text-sm text-slate-600">
          <li className="flex items-center justify-between">
            <span className="truncate">Wolverine Watch 2025</span>
            <span className="text-xs text-slate-400">2</span>
          </li>
          <li className="flex items-center justify-between">
            <span className="truncate">Alpine Pika Survey</span>
            <span className="text-xs text-slate-400">1</span>
          </li>
          <li className="flex items-center justify-between">
            <span className="truncate">Coastal Kelp Monitoring</span>
            <span className="text-xs text-slate-400">1</span>
          </li>
          <li className="flex items-center justify-between">
            <span className="truncate">River Otter Distribution</span>
            <span className="text-xs text-slate-400">1</span>
          </li>
        </ul>
      </div>

      <div className="mt-auto px-5 pb-5 pt-4 text-[11px] leading-relaxed text-slate-500">
        <p className="font-medium text-slate-600">Operator: Jordan R.</p>
        <p>Local time America/Denver</p>
      </div>
    </aside>
  );
}
