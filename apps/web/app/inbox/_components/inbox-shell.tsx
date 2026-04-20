import type { ReactNode } from "react";

import type {
  InboxFilterId,
  InboxListViewModel
} from "../_lib/view-models";
import { PrimaryIconRail } from "@/app/_components/primary-icon-rail";

import { InboxClientProvider } from "./inbox-client-provider";
import { InboxFreshnessPoller } from "./inbox-freshness-poller";
import { InboxKeyboardProvider } from "./inbox-keyboard-provider";
import { InboxList } from "./inbox-list";

interface ShellProps {
  readonly initialList: InboxListViewModel;
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
  initialList,
  initialFilterId,
  children
}: ShellProps) {
  return (
    <InboxClientProvider>
      <InboxKeyboardProvider>
        <InboxFreshnessPoller listFreshness={initialList.freshness} />
        <PrimaryIconRail />

        <InboxList
          initialList={initialList}
          initialFilterId={initialFilterId}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </InboxKeyboardProvider>
    </InboxClientProvider>
  );
}
