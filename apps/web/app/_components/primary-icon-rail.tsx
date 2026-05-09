"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Inbox as InboxIcon,
  LogOut as LogOutIcon,
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
          className="mb-4 flex size-9 items-center justify-center text-slate-900"
          aria-label="Adventure Scientists"
        >
          <AdventureScientistsLogo className="size-8" />
        </div>

        <div className="flex flex-1 flex-col items-center gap-1">
          {ITEMS.map((item) => {
            const Icon = item.Icon;
            const active = isActive(pathname, item.activePrefixes);
            const baseClass = `flex size-10 items-center justify-center ${RADIUS.lg} ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} ${
              active
                ? "bg-[#253746] text-white"
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
                      <Icon className="size-5" />
                    </button>
                  ) : (
                    <Link
                      href={item.href}
                      aria-label={item.label}
                      aria-current={active ? "page" : undefined}
                      className={baseClass}
                    >
                      <Icon className="size-5" />
                    </Link>
                  )}
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  className="rounded-md bg-[#253746] px-2 py-1 text-xs font-medium text-white"
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
            "mt-2 grid size-10 place-items-center border border-slate-200 bg-white text-slate-700",
            RADIUS.full,
            SHADOW.sm,
            TRANSITION.fast,
            TRANSITION.reduceMotion,
            FOCUS_RING,
            "hover:border-slate-300 hover:shadow-md",
            open && "border-slate-300 shadow-md"
          )}
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-[#253746] text-[11px] font-semibold text-white">
            {operator.initials}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#253746] text-[11px] font-semibold text-white">
              {operator.initials}
            </div>
            <div className="min-w-0">
              {operator.displayName !== operator.email ? (
                <p className="truncate text-sm font-semibold text-slate-900">
                  {operator.displayName}
                </p>
              ) : null}
              <p
                className={cn(
                  "truncate",
                  operator.displayName !== operator.email
                    ? "text-[11px] text-slate-500"
                    : "text-sm font-semibold text-slate-900",
                )}
              >
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
            <LogOutIcon className="size-3.5" />
            Log out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
