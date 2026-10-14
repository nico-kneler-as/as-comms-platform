import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { PrimaryIconRail } from "@/app/_components/primary-icon-rail";
import {
  railAccessFor,
  requireWorkspace
} from "@/src/server/auth/workspace-access";

import { SettingsSectionNav } from "./_components/settings-section-nav";

export const metadata = {
  title: "Settings"
};

/**
 * Settings is authenticated-only; the layout gates every `/settings` render
 * at the DB-backed session boundary. Static generation is disabled because
 * every render reads the caller's session.
 *
 * Column distribution mirrors `/inbox` so the two surfaces feel like the
 * same platform:
 *   1. Shared {@link PrimaryIconRail} (`w-14`) — gear is active on any
 *      `/settings/*` route.
 *   2. {@link SettingsSectionNav} (`w-[22rem]`) — Active Projects / Team /
 *      Integrations rows styled like the inbox list column.
 *   3. `<main>` (flex-1) — renders the active section's page, or the
 *      project detail view.
 */
export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children
}: {
  readonly children: ReactNode;
}) {
  const access = await requireWorkspace("volunteers").catch((error: unknown) => {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      redirect("/");
    }
    throw error;
  });
  const currentUser = access.user;

  return (
    <div className="flex min-h-dvh w-full bg-slate-100 text-slate-900 antialiased">
      <PrimaryIconRail
        access={railAccessFor(access)}
        operator={{
          initials: getInitials(currentUser.name ?? currentUser.email),
          displayName: currentUser.name ?? currentUser.email,
          email: currentUser.email
        }}
      />
      <SettingsSectionNav />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

function getInitials(value: string): string {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
