import type { InboxFilterId } from "./view-models";

interface FilterDefinition {
  readonly id: InboxFilterId;
  readonly label: string;
  readonly hint: string | null;
}

/**
 * Secondary filter chips for the inbox list. The default view shows all
 * contacts sorted by last inbound message. These filters narrow the list
 * to contacts matching a specific row state.
 *
 * Follow-up is client-side ephemeral state owned by
 * {@link InboxClientProvider}; the server-side list doesn't know who
 * is flagged, so its count starts at 0 and the client recomputes it.
 */
export const INBOX_FILTERS: readonly FilterDefinition[] = [
  { id: "all", label: "All", hint: null },
  { id: "unread", label: "Unread", hint: "New inbound message" },
  { id: "follow-up", label: "Needs Follow-Up", hint: "Flagged by you" },
  { id: "unresolved", label: "Unresolved", hint: "Has pending review items" }
];
