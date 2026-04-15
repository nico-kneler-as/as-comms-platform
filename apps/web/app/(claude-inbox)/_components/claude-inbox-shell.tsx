import type { ReactNode } from "react";

import type {
  ClaudeInboxFilterId,
  ClaudeInboxFilterViewModel,
  ClaudeInboxListItemViewModel
} from "../_lib/view-models";
import { ClaudeInboxClientProvider } from "./claude-inbox-client-provider";
import { ClaudeInboxIconRail } from "./claude-inbox-icon-rail";
import { ClaudeInboxList } from "./claude-inbox-list";

interface ShellProps {
  readonly filters: readonly ClaudeInboxFilterViewModel[];
  readonly items: readonly ClaudeInboxListItemViewModel[];
  readonly initialFilterId: ClaudeInboxFilterId;
  readonly children: ReactNode;
}

/**
 * Server shell: renders the persistent chrome once for every `/inbox` route.
 * The {@link ClaudeInboxClientProvider} is the client boundary that holds
 * ephemeral UI state shared across the list column and the detail workspace
 * — specifically which contacts are flagged "Needs Follow Up" and which
 * have a reminder pending — so those two islands can stay in sync without
 * hoisting a store into the canonical data layer.
 */
export function ClaudeInboxShell({
  filters,
  items,
  initialFilterId,
  children
}: ShellProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-900 antialiased">
      <ClaudeInboxClientProvider>
        <ClaudeInboxIconRail />

        <ClaudeInboxList
          items={items}
          filters={filters}
          initialFilterId={initialFilterId}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </ClaudeInboxClientProvider>
    </div>
  );
}
