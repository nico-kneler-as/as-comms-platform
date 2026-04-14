import type { ComponentType, SVGProps } from "react";

import {
  InboxIcon,
  SettingsIcon,
  SparkleIcon,
  UsersIcon
} from "./claude-icons.js";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface RailItem {
  readonly id: string;
  readonly label: string;
  readonly Icon: IconComponent;
  readonly active?: boolean;
}

const ITEMS: readonly RailItem[] = [
  { id: "inbox", label: "Inbox", Icon: InboxIcon, active: true },
  { id: "people", label: "People", Icon: UsersIcon },
  { id: "ai", label: "Drafts", Icon: SparkleIcon },
  { id: "settings", label: "Settings", Icon: SettingsIcon }
];

export function ClaudeInboxIconRail() {
  return (
    <nav
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-white py-4"
      aria-label="Primary"
    >
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white">
        AS
      </div>
      {ITEMS.map((item) => {
        const Icon = item.Icon;
        return (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            aria-current={item.active ? "page" : undefined}
            className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition ${
              item.active
                ? "bg-slate-900 text-white"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span className="pointer-events-none absolute left-12 z-20 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-sm group-hover:opacity-100">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
