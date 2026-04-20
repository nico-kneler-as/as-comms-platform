import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { PrimaryIconRail } from "@/app/_components/primary-icon-rail";
import { requireSession } from "@/src/server/auth/session";

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
 *   2. {@link SettingsSectionNav} (`w-[22rem]`) — Active Projects / Access /
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
  try {
    await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    throw error;
  }

  return (
    <div className="flex min-h-screen w-full bg-slate-100 text-slate-900 antialiased">
      <PrimaryIconRail />
      <SettingsSectionNav />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
