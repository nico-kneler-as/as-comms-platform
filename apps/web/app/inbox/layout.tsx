import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { requireSession } from "@/src/server/auth/session";

import { InboxShell } from "./_components/inbox-shell";
import { getInboxComposerAliases } from "./_lib/composer-data";
import { getInboxIntegrationHealthBanner } from "./_lib/integration-health";
import { getInboxList } from "./_lib/selectors";

export const metadata = {
  title: "Inbox",
};

/**
 * The inbox is per-operator and backed by request-time projection reads
 * against Railway's runtime-only Postgres host. Opt out of build-time
 * static generation so the layout's DB fetch doesn't run during
 * `next build` (where `postgres.railway.internal` doesn't resolve).
 * Applies to all descendant routes (`/inbox`, `/inbox/[contactId]`,
 * `/inbox/states`).
 */
export const dynamic = "force-dynamic";

/**
 * Server Component: composes the persistent shell (icon rail + list column)
 * once for both `/inbox` and `/inbox/[contactId]`. The page slot underneath
 * renders either the empty state or the selected-contact detail workspace.
 *
 * Following FP-01/FP-02: the initial inbox page is assembled here from a
 * server-side selector and only minimized view models flow into the client
 * list island. The client fetches additional filtered pages on demand, while
 * canonical queue state remains server-owned.
 */
export default async function InboxLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const currentUser = await requireSession().catch((error: unknown) => {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    throw error;
  });

  const __t0 = Date.now();
  async function __timed<T>(label: string, p: Promise<T>): Promise<T> {
    const s = Date.now();
    try {
      return await p;
    } finally {
      console.log(`[ibx-perf] ${label}=${String(Date.now() - s)}ms`);
    }
  }
  console.log(`[ibx-perf] start session=${currentUser.id}`);
  const [list, composerAliases, healthBanner] = await Promise.all([
    __timed("getInboxList", getInboxList("all")),
    __timed("getInboxComposerAliases", getInboxComposerAliases()),
    __timed("getInboxIntegrationHealthBanner", getInboxIntegrationHealthBanner()),
  ]);
  console.log(`[ibx-perf] total=${String(Date.now() - __t0)}ms`);

  return (
    <InboxShell
      initialList={list}
      initialFilterId="all"
      composerAliases={composerAliases}
      healthBanner={healthBanner}
      currentActorId={currentUser.id}
      operator={{
        initials: getInitials(currentUser.name ?? currentUser.email),
        displayName: currentUser.name ?? currentUser.email,
        email: currentUser.email
      }}
    >
      {children}
    </InboxShell>
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
