import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentUser, requireSession } from "@/src/server/auth/session";

import { SettingsSidebar } from "./_components/settings-sidebar";

export const metadata = {
  title: "Settings"
};

/**
 * Settings is authenticated-only; the layout gates every `/settings/*` route
 * at the DB-backed session boundary. Static generation is disabled because
 * every render reads the caller's session.
 *
 * Per-page role gating (for example admin-only Users & Roles) lives in the
 * page itself — the layout intentionally does not enforce admin so operators
 * can still reach aliases, organization, and integrations.
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

  // Fetched here (not passed into the sidebar) so the sidebar stays a lean
  // client island. The layout does not currently use the user object, but
  // having it resolved ensures the DB-backed identity lookup succeeded.
  await getCurrentUser();

  return (
    <div className="flex min-h-screen w-full bg-slate-100 text-slate-900 antialiased">
      <SettingsSidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
