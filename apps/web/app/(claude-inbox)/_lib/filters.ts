import type { ClaudeInboxFilterId } from "./view-models";

interface FilterDefinition {
  readonly id: ClaudeInboxFilterId;
  readonly label: string;
  readonly hint: string | null;
}

/**
 * Filter surface for the left sidebar.
 *
 * `new` and `opened` are the canonical queue buckets. `starred` and
 * `unresolved` are overlays — selecting them filters the same contact list
 * without changing what the underlying bucket is.
 */
export const CLAUDE_INBOX_FILTERS: readonly FilterDefinition[] = [
  { id: "new", label: "New", hint: "Unread or freshly reset" },
  { id: "opened", label: "Opened", hint: "You've engaged" },
  { id: "starred", label: "Starred", hint: "Follow-up flag" },
  { id: "unresolved", label: "Unresolved", hint: "Needs manual review" },
  { id: "all", label: "All people", hint: null }
];
