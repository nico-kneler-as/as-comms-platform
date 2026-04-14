import type { ReactNode } from "react";

import type {
  ClaudeInboxFilterId,
  ClaudeInboxFilterViewModel,
  ClaudeInboxListItemViewModel
} from "../_lib/view-models";
import { ClaudeInboxIconRail } from "./claude-inbox-icon-rail";
import { ClaudeInboxList } from "./claude-inbox-list";

interface ShellProps {
  readonly filters: readonly ClaudeInboxFilterViewModel[];
  readonly items: readonly ClaudeInboxListItemViewModel[];
  readonly initialFilterId: ClaudeInboxFilterId;
  readonly listSubtitle: string;
  readonly children: ReactNode;
}

export function ClaudeInboxShell({
  filters,
  items,
  initialFilterId,
  listSubtitle,
  children
}: ShellProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-900 antialiased">
      <ClaudeInboxIconRail />

      <ClaudeInboxList
        items={items}
        filters={filters}
        initialFilterId={initialFilterId}
        subtitle={listSubtitle}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
