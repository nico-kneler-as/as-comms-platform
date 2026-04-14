import type { ReactNode } from "react";

import type {
  ClaudeInboxFilterViewModel,
  ClaudeInboxListItemViewModel
} from "../_lib/view-models.js";
import { ClaudeInboxIconRail } from "./claude-inbox-icon-rail.js";
import { ClaudeInboxList } from "./claude-inbox-list.js";
import { ClaudeInboxListHeader } from "./claude-inbox-list-header.js";
import { ClaudeInboxSidebar } from "./claude-inbox-sidebar.js";

interface ShellProps {
  readonly filters: readonly ClaudeInboxFilterViewModel[];
  readonly activeFilterId: string;
  readonly items: readonly ClaudeInboxListItemViewModel[];
  readonly listTitle: string;
  readonly listSubtitle: string;
  readonly children: ReactNode;
}

export function ClaudeInboxShell({
  filters,
  activeFilterId,
  items,
  listTitle,
  listSubtitle,
  children
}: ShellProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-900 antialiased">
      <ClaudeInboxIconRail />
      <ClaudeInboxSidebar filters={filters} activeFilterId={activeFilterId} />

      <section className="flex w-[22rem] shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
        <ClaudeInboxListHeader
          title={listTitle}
          subtitle={listSubtitle}
          totalCount={items.length}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ClaudeInboxList items={items} />
        </div>
      </section>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
