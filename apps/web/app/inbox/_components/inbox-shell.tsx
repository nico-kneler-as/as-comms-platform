import type { ReactNode } from "react";

import type {
  InboxFilterId,
  InboxFilterViewModel,
  InboxListItemViewModel
} from "../_lib/view-models";
import { InboxClientProvider } from "./inbox-client-provider";
import { InboxIconRail } from "./inbox-icon-rail";
import { InboxList } from "./inbox-list";

interface ShellProps {
  readonly filters: readonly InboxFilterViewModel[];
  readonly items: readonly InboxListItemViewModel[];
  readonly initialFilterId: InboxFilterId;
  readonly children: ReactNode;
}

/**
 * Server shell: renders the persistent chrome once for every `/inbox` route.
 * The {@link InboxClientProvider} is the client boundary that holds
 * ephemeral UI state shared across the list column and the detail workspace:
 * reminders, search state, loading indicators, and composer draft status.
 *
 * Canonical inbox row state remains server-owned and flows through the
 * server selectors for both the list shell and the selected-contact detail.
 */
export function InboxShell({
  filters,
  items,
  initialFilterId,
  children
}: ShellProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-900 antialiased">
      <InboxClientProvider>
        <InboxIconRail />

        <InboxList
          items={items}
          filters={filters}
          initialFilterId={initialFilterId}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </InboxClientProvider>
    </div>
  );
}
