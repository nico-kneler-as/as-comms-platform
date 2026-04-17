import type { ReactNode } from "react";

import { InboxShell } from "./_components/inbox-shell";
import { getInboxList } from "./_lib/selectors";

export const metadata = {
  title: "Inbox"
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
 * Following FP-01/FP-02: the full list is assembled here from a server-side
 * selector and only minimized view models flow into the client list island.
 * The client applies the active filter locally against those view models, so
 * the sidebar collapse has no effect on where canonical state lives.
 */
export default async function InboxLayout({
  children
}: {
  readonly children: ReactNode;
}) {
  const list = await getInboxList("all");

  return (
    <InboxShell
      filters={list.filters}
      items={list.items}
      initialFilterId="all"
    >
      {children}
    </InboxShell>
  );
}
