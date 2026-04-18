"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface SettingsNavItem {
  readonly href: string;
  readonly label: string;
  readonly description: string;
}

/**
 * Static link set. Role enforcement happens server-side in each page; the
 * sidebar always renders the full list so operators understand the shape of
 * the admin surface, and non-admin routes simply reject the navigation.
 */
const ITEMS: readonly SettingsNavItem[] = [
  {
    href: "/settings/aliases",
    label: "Project Aliases",
    description: "Inbox → project routing"
  },
  {
    href: "/settings/users",
    label: "Users & Roles",
    description: "Admin only"
  },
  {
    href: "/settings/organization",
    label: "Organization",
    description: "Workspace metadata"
  },
  {
    href: "/settings/integrations",
    label: "Integrations",
    description: "Provider connections"
  }
];

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

export function SettingsSidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Settings"
      className="flex w-64 shrink-0 flex-col gap-1 border-r border-slate-200 bg-white px-3 py-6"
    >
      <div className="px-3 pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Settings
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-slate-900 text-white"
                    : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <span className="font-medium">{item.label}</span>
                <span
                  className={cn(
                    "text-[11px]",
                    active ? "text-slate-200" : "text-slate-500"
                  )}
                >
                  {item.description}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
