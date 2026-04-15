import type { ReactNode } from "react";

import { ClaudeInboxShell } from "../_components/claude-inbox-shell";
import { getClaudeInboxList } from "../_lib/selectors";

export const metadata = {
  title: "Inbox · Claude prototype"
};

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
export default function ClaudeInboxLayout({
  children
}: {
  readonly children: ReactNode;
}) {
  const list = getClaudeInboxList("all");

  return (
    <ClaudeInboxShell
      filters={list.filters}
      items={list.items}
      initialFilterId="new"
    >
      {children}
    </ClaudeInboxShell>
  );
}
