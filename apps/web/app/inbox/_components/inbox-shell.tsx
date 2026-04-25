import type { ReactNode } from "react";

import type {
  InboxFilterId,
  InboxListViewModel,
  InboxComposerAliasOption
} from "../_lib/view-models";
import type { InboxIntegrationHealthBannerViewModel } from "../_lib/integration-health";
import { PrimaryIconRail } from "@/app/_components/primary-icon-rail";

import { IntegrationHealthBanner } from "./integration-health-banner";
import { InboxClientProvider } from "./inbox-client-provider";
import { InboxFreshnessPoller } from "./inbox-freshness-poller";
import { InboxKeyboardProvider } from "./inbox-keyboard-provider";
import { InboxList } from "./inbox-list";
import { InboxWorkspace } from "./inbox-workspace";

interface ShellProps {
  readonly initialList: InboxListViewModel;
  readonly initialFilterId: InboxFilterId;
  readonly composerAliases: readonly InboxComposerAliasOption[];
  readonly healthBanner: InboxIntegrationHealthBannerViewModel | null;
  readonly currentActorId: string;
  readonly operator: {
    readonly initials: string;
    readonly displayName: string;
    readonly email: string;
  };
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
  composerAliases,
  healthBanner,
  currentActorId,
  operator,
  children
}: ShellProps) {
  return (
    <InboxClientProvider
      composerAliases={composerAliases}
      currentActorId={currentActorId}
    >
      <InboxKeyboardProvider>
        <InboxFreshnessPoller listFreshness={initialList.freshness} />
        <PrimaryIconRail operator={operator} />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <IntegrationHealthBanner banner={healthBanner} />

          <div className="flex min-h-0 flex-1">
            <InboxList
              initialList={initialList}
              initialFilterId={initialFilterId}
            />

            <InboxWorkspace>{children}</InboxWorkspace>
          </div>
        </div>
      </InboxKeyboardProvider>
    </InboxClientProvider>
  );
}
