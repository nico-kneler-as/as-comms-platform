import { EmptyState } from "@/components/ui/empty-state";
import { SectionLabel } from "@/components/ui/section-label";
import {
  LAYOUT,
  RADIUS,
  SHADOW,
  TEXT,
} from "@/app/_lib/design-tokens";

import type { InboxWelcomeWorkloadViewModel } from "../_lib/view-models";
import { CheckCircleIcon, InboxIcon } from "./icons";

interface InboxWelcomeWorkloadProps {
  readonly workload: InboxWelcomeWorkloadViewModel;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatWorkSummary(workload: InboxWelcomeWorkloadViewModel): string {
  if (workload.totals.activeProjects === 0) {
    return "No active projects are currently enabled.";
  }

  if (workload.totals.unread === 0 && workload.totals.needsFollowUp === 0) {
    return "No unread or follow-up work across active projects.";
  }

  const unread =
    workload.totals.unread === 1
      ? "1 unread conversation"
      : `${formatCount(workload.totals.unread)} unread conversations`;
  const followUp =
    workload.totals.needsFollowUp === 1
      ? "1 needs follow-up"
      : `${formatCount(workload.totals.needsFollowUp)} need follow-up`;

  return `${unread}; ${followUp}.`;
}

export function InboxWelcomeWorkload({
  workload,
}: InboxWelcomeWorkloadProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <header
        className={`flex ${LAYOUT.headerHeight} items-center border-b border-slate-200 bg-white px-6`}
      >
        <div className="min-w-0">
          <h1 className={TEXT.headingLg}>Welcome Sam!</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Active project workload from inbox projections.
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-8">
          <div className="flex flex-col gap-1">
            <SectionLabel as="h2">Today</SectionLabel>
            <p className={TEXT.bodySm}>{formatWorkSummary(workload)}</p>
          </div>

          {workload.projects.length === 0 ? (
            <div
              className={`${RADIUS.md} border border-slate-200 bg-white ${SHADOW.sm}`}
            >
              <EmptyState
                icon={<InboxIcon className="h-6 w-6" />}
                title="No active project workload"
                description="Activate projects in Settings to show unread and follow-up counts here."
              />
            </div>
          ) : (
            <div
              className={`overflow-hidden ${RADIUS.md} border border-slate-200 bg-white ${SHADOW.sm}`}
            >
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
                <CheckCircleIcon className="h-4 w-4 text-emerald-600" />
                <p className="text-xs font-medium text-slate-600">
                  Active projects only
                </p>
              </div>

              <table className="w-full table-fixed text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-xs font-medium text-slate-500"
                    >
                      Project
                    </th>
                    <th
                      scope="col"
                      className="w-24 px-4 py-2.5 text-right text-xs font-medium text-slate-500"
                    >
                      Unread
                    </th>
                    <th
                      scope="col"
                      className="w-36 px-4 py-2.5 text-right text-xs font-medium text-slate-500"
                    >
                      Needs Follow-Up
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workload.projects.map((project) => {
                    const hasWork =
                      project.unreadCount > 0 ||
                      project.needsFollowUpCount > 0;

                    return (
                      <tr key={project.projectId}>
                        <th
                          scope="row"
                          className="min-w-0 px-4 py-3 text-sm font-medium text-slate-900"
                        >
                          <span className="block truncate">
                            {project.projectName}
                          </span>
                          {!hasWork ? (
                            <span className="mt-0.5 block text-xs font-normal text-slate-400">
                              No active queue items
                            </span>
                          ) : null}
                        </th>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-700">
                          {formatCount(project.unreadCount)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-700">
                          {formatCount(project.needsFollowUpCount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
