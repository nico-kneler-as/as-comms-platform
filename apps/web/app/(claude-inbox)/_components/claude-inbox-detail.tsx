"use client";

import { useState } from "react";

import type { ClaudeInboxDetailViewModel } from "../_lib/view-models";
import { ClaudeInboxComposer } from "./claude-inbox-composer";
import {
  ClaudeInboxContactRail,
  ProjectStatusBadge
} from "./claude-inbox-contact-rail";
import { ClaudeInboxTimeline } from "./claude-inbox-timeline";
import { PanelRightCloseIcon, PanelRightOpenIcon } from "./claude-icons";

interface DetailProps {
  readonly detail: ClaudeInboxDetailViewModel;
}

/**
 * Client island: owns the right-rail disclosure state (`railOpen`). The rail
 * is collapsed by default and only expanded when the operator clicks
 * "Volunteer Details" in the top bar. All data still flows down from the
 * server selector — the client only toggles visibility.
 */
export function ClaudeInboxDetail({ detail }: DetailProps) {
  const { contact, timeline, smsEligible } = detail;
  const [railOpen, setRailOpen] = useState(false);

  const activeProject = contact.activeProjects[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col border-r border-slate-200 bg-white">
        <header className="flex h-[65px] items-center justify-between gap-4 border-b border-slate-200 px-6">
          <div className="flex min-w-0 items-center gap-4">
            <h1 className="truncate text-lg font-semibold text-slate-900">
              {contact.displayName}
            </h1>
            <div className="hidden h-5 w-px bg-slate-200 sm:block" />
            <div className="hidden min-w-0 sm:block">
              {activeProject ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="truncate font-medium text-slate-700">
                    {activeProject.projectName} {activeProject.year.toString()}
                  </span>
                  <ProjectStatusBadge status={activeProject.status} />
                </div>
              ) : (
                <span className="text-xs text-slate-400">No active project</span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Set as Pending
            </button>
            {railOpen ? (
              <button
                type="button"
                aria-label="Collapse volunteer details"
                aria-expanded={true}
                aria-controls="claude-inbox-contact-rail"
                onClick={() => {
                  setRailOpen(false);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-900 shadow-sm transition hover:bg-slate-200"
              >
                <PanelRightCloseIcon className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                aria-label="Expand volunteer details"
                aria-expanded={false}
                aria-controls="claude-inbox-contact-rail"
                onClick={() => {
                  setRailOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <PanelRightOpenIcon className="h-3.5 w-3.5" />
                Volunteer Details
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-50/40 px-6 py-6">
          <ClaudeInboxTimeline entries={timeline} />
        </div>

        <ClaudeInboxComposer
          contactDisplayName={contact.displayName}
          smsEligible={smsEligible}
        />
      </section>

      {railOpen ? <ClaudeInboxContactRail contact={contact} /> : null}
    </div>
  );
}
