import type { ClaudeInboxFilterId } from "./view-models";

interface FilterDefinition {
  readonly id: ClaudeInboxFilterId;
  readonly label: string;
  readonly hint: string | null;
}

/**
 * Filter surface for the list column. The prototype limits this to three
 * buckets — everything, unread-only, and contacts the operator has flagged
 * for follow-up. Follow-up is client-side ephemeral state owned by
 * {@link ClaudeInboxClientProvider}; the server-side list doesn't know who
 * is flagged, so its count starts at 0 and the client recomputes it.
 */
export const CLAUDE_INBOX_FILTERS: readonly FilterDefinition[] = [
  { id: "all", label: "All", hint: null },
  { id: "unread", label: "Unread", hint: "At least one unread message" },
  { id: "follow-up", label: "Needs Follow-Up", hint: "Flagged by you" }
];
