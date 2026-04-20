"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { FolderOpen, Plug, Users } from "lucide-react";

import {
  FOCUS_RING,
  LAYOUT,
  RADIUS,
  SPACING,
  TEXT,
  TRANSITION
} from "@/app/_lib/design-tokens";
import { cn } from "@/lib/utils";

interface SectionItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly href: string;
  readonly Icon: LucideIcon;
}

const ITEMS: readonly SectionItem[] = [
  {
    id: "active-projects",
    label: "Active Projects",
    description: "Projects currently receiving inbound mail.",
    href: "/settings/active-projects",
    Icon: FolderOpen
  },
  {
    id: "access",
    label: "Access",
    description: "Teammates, roles, and deactivated accounts.",
    href: "/settings/access",
    Icon: Users
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "Providers this workspace depends on.",
    href: "/settings/integrations",
    Icon: Plug
  }
];

function isSectionActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Settings section rail. Mirrors the inbox list column: fixed width, sticky
 * header, rows in the same list-item density with a sky highlight when
 * selected. Every row is a `<Link>` so the browser URL stays the source of
 * truth for the active section.
 */
export function SettingsSectionNav() {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-slate-200 bg-white",
        LAYOUT.listWidth
      )}
      aria-label="Settings sections"
    >
      <div
        className={cn(
          "flex items-center border-b border-slate-200",
          LAYOUT.headerHeight,
          SPACING.section
        )}
      >
        <h2 className={TEXT.headingSm}>Settings</h2>
      </div>

      <nav className="flex flex-col gap-0.5 p-2">
        {ITEMS.map((item) => {
          const active = isSectionActive(pathname, item.href);
          const Icon = item.Icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-start gap-3",
                SPACING.listItem,
                RADIUS.md,
                TRANSITION.fast,
                TRANSITION.reduceMotion,
                FOCUS_RING,
                active
                  ? "bg-sky-50/60 ring-1 ring-inset ring-sky-200"
                  : "hover:bg-slate-50/80"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center",
                  RADIUS.md,
                  active
                    ? "bg-white text-sky-700 ring-1 ring-sky-200"
                    : "bg-slate-100 text-slate-600 group-hover:bg-white group-hover:text-slate-700"
                )}
                aria-hidden="true"
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate",
                    active ? TEXT.headingSm : "text-sm font-medium text-slate-800"
                  )}
                >
                  {item.label}
                </span>
                <span className={cn("mt-0.5 block truncate", TEXT.caption)}>
                  {item.description}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
