import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { requireSession } from "@/src/server/auth/session";

export const metadata = {
  title: "Settings"
};

/**
 * Settings is authenticated-only; the layout gates every `/settings` render
 * at the DB-backed session boundary. Static generation is disabled because
 * every render reads the caller's session.
 *
 * The redesigned Settings surface is a single page with three stacked
 * sections (Projects, Access, Integrations), so this layout is intentionally
 * thin: it authenticates, then delegates the entire page layout to the child
 * (`page.tsx`). No sidebar, no per-section navigation.
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
    <div className="flex min-h-screen w-full flex-col bg-slate-100 text-slate-900 antialiased">
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
