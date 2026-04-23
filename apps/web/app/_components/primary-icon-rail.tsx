"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Inbox as InboxIcon,
  LogOut as LogOutIcon,
  Megaphone as MegaphoneIcon,
  Settings as SettingsIcon
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
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
  FOCUS_RING,
  LAYOUT,
  RADIUS,
  SHADOW,
  TRANSITION
} from "@/app/_lib/design-tokens";
import { cn } from "@/lib/utils";

import { AdventureScientistsLogo } from "./adventure-scientists-logo";
import { signOutOperatorAction } from "./operator-menu-actions";

interface RailItem {
  readonly id: string;
  readonly label: string;
  readonly Icon: LucideIcon;
  readonly href: string | null;
  readonly activePrefixes: readonly string[];
}

export interface PrimaryRailOperator {
  readonly initials: string;
  readonly displayName: string;
  readonly email: string;
}

const ITEMS: readonly RailItem[] = [
  {
    id: "inbox",
    label: "Inbox",
    Icon: InboxIcon,
    href: "/inbox",
    activePrefixes: ["/inbox"]
  },
  {
    id: "campaigns",
    label: "Campaigns",
    Icon: MegaphoneIcon,
    href: null,
    activePrefixes: ["/campaigns"]
  },
  {
    id: "settings",
    label: "Settings",
    Icon: SettingsIcon,
    href: "/settings",
    activePrefixes: ["/settings"]
  }
];

function isActive(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function PrimaryIconRail({
  operator
}: {
  readonly operator: PrimaryRailOperator;
}) {
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        className={`flex ${LAYOUT.iconRailWidth} shrink-0 flex-col items-center border-r border-slate-200 bg-white py-4`}
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
            const active = isActive(pathname, item.activePrefixes);
            const baseClass = `flex h-10 w-10 items-center justify-center ${RADIUS.lg} ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} ${
              active
                ? "bg-slate-900 text-white"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            }`;

            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  {item.href === null ? (
                    <button
                      type="button"
                      aria-label={item.label}
                      aria-current={active ? "page" : undefined}
                      aria-disabled="true"
                      tabIndex={-1}
                      className={baseClass}
                    >
                      <Icon className="h-5 w-5" />
                    </button>
                  ) : (
                    <Link
                      href={item.href}
                      aria-label={item.label}
                      aria-current={active ? "page" : undefined}
                      className={baseClass}
                    >
                      <Icon className="h-5 w-5" />
                    </Link>
                  )}
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white"
                >
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <OperatorMenu operator={operator} />
      </nav>
    </TooltipProvider>
  );
}

function OperatorMenu({
  operator
}: {
  readonly operator: PrimaryRailOperator;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${operator.displayName} · account menu`}
          className={cn(
            "group mt-2 flex h-10 items-center gap-2 overflow-hidden border border-slate-200 bg-white pl-0.5 pr-2 text-left text-slate-700",
            RADIUS.full,
            SHADOW.sm,
            TRANSITION.layout,
            TRANSITION.reduceMotion,
            FOCUS_RING,
            open
              ? "w-44 border-slate-300 shadow-md"
              : "w-10 hover:w-44 hover:border-slate-300 hover:shadow-md focus-visible:w-44"
          )}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
            {operator.initials}
          </span>
          <span
            className={cn(
              "min-w-0 overflow-hidden whitespace-nowrap text-xs font-medium transition-all duration-200 ease-out motion-reduce:transition-none",
              open
                ? "max-w-24 opacity-100"
                : "max-w-0 opacity-0 group-hover:max-w-24 group-hover:opacity-100 group-focus-visible:max-w-24 group-focus-visible:opacity-100"
            )}
          >
            {operator.displayName}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
              {operator.initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {operator.displayName}
              </p>
              <p className="truncate text-[11px] text-slate-500">
                {operator.email}
              </p>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={signOutOperatorAction}>
          <button
            type="submit"
            className="relative flex w-full select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
          >
            <LogOutIcon className="h-3.5 w-3.5" />
            Log out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
