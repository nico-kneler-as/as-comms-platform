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
 * ephemeral UI state shared across the list column and the detail workspace
 * — specifically which contacts are flagged "Needs Follow Up" and which
 * have a reminder pending — so those two islands can stay in sync without
 * hoisting a store into the canonical data layer.
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
