import type { ReactNode } from "react";

import { ClaudeInboxShell } from "../_components/claude-inbox-shell.js";
import { CLAUDE_INBOX_FILTERS } from "../_lib/filters.js";
import { getClaudeInboxList } from "../_lib/selectors.js";

export const metadata = {
  title: "Inbox · Claude prototype"
};

/**
 * Server Component: composes the persistent shell (icon rail, sidebar, list)
 * once for both `/inbox` and `/inbox/[contactId]`. The page slot underneath
 * renders either the empty state or the selected-contact detail workspace.
 *
 * Following FP-01/FP-02: the list is assembled here from a server-side
 * selector and only minimized view models flow into the client list island.
 */
export default function ClaudeInboxLayout({
  children
}: {
  readonly children: ReactNode;
}) {
  const list = getClaudeInboxList("new");
  const activeFilter = CLAUDE_INBOX_FILTERS[0]?.id ?? "new";

  return (
    <ClaudeInboxShell
      filters={list.filters}
      activeFilterId={activeFilter}
      items={list.items}
      listTitle="New"
      listSubtitle="People waiting on you"
    >
      {children}
    </ClaudeInboxShell>
  );
}
