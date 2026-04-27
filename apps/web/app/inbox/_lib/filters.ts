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
 * The base follow-up state comes from the projection-backed
 * `needsFollowUp` field. The client may layer temporary overrides on top
 * while the shell is still mock-wired.
 */
export const INBOX_FILTERS: readonly FilterDefinition[] = [
  { id: "all", label: "All", hint: null },
  { id: "unread", label: "Unread", hint: "New inbound message" },
  { id: "follow-up", label: "Needs Follow-Up", hint: "Flagged by you" },
  { id: "sent", label: "Sent", hint: "Last outbound 1:1 message" },
];

/**
 * Filters surfaced in the list column filter panel. Unresolved is tracked
 * server-side and surfaced via the detail rail + banner, not offered as a
 * top-level filter — operators triage it per row.
 */
export const DISPLAY_INBOX_FILTERS: readonly FilterDefinition[] =
  INBOX_FILTERS;
