"use client";

import type { LucideIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";

import {
  AdventureScientistsLogo,
  InboxIcon,
  LogOutIcon,
  MegaphoneIcon,
  SettingsIcon
} from "./claude-icons";

interface RailItem {
  readonly id: string;
  readonly label: string;
  readonly Icon: LucideIcon;
  readonly active?: boolean;
}

/**
 * Prototype left nav. Kept to three destinations per product brief — Inbox,
 * Campaigns, Settings — so the icon strip doesn't drift into speculative
 * sections. The bottom slot hosts a user circle that reveals the operator's
 * name and a Log out affordance on hover.
 */
const ITEMS: readonly RailItem[] = [
  { id: "inbox", label: "Inbox", Icon: InboxIcon, active: true },
  { id: "campaigns", label: "Campaigns", Icon: MegaphoneIcon },
  { id: "settings", label: "Settings", Icon: SettingsIcon }
];

const OPERATOR = {
  initials: "JC",
  displayName: "Jordan Cole",
  email: "jordan@adventurescientists.org"
};

export function ClaudeInboxIconRail() {
  return (
    <TooltipProvider delayDuration={200}>
      <nav
        className="flex w-14 shrink-0 flex-col items-center border-r border-slate-200 bg-white py-4"
        aria-label="Primary"
      >
        <div
          className="mb-4 flex h-9 w-9 items-center justify-center text-slate-900"
          aria-label="Adventure Scientists"
        >
          <AdventureScientistsLogo className="h-8 w-8" />
        </div>

        <div className="flex flex-1 flex-col items-center gap-1">
          {ITEMS.map((item) => {
            const Icon = item.Icon;
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={item.label}
                    aria-current={item.active ? "page" : undefined}
                    className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 motion-reduce:transition-none ${
                      item.active
                        ? "bg-slate-900 text-white"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <OperatorMenu />
      </nav>
    </TooltipProvider>
  );
}

function OperatorMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${OPERATOR.displayName} · account menu`}
          className="mt-2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
        >
          {OPERATOR.initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
              {OPERATOR.initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {OPERATOR.displayName}
              </p>
              <p className="truncate text-[11px] text-slate-500">
                {OPERATOR.email}
              </p>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 text-xs font-medium">
          <LogOutIcon className="h-3.5 w-3.5" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
