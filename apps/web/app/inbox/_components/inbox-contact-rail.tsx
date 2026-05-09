"use client";

import type {
  InboxContactSummaryViewModel,
  InboxProjectMembershipViewModel,
  InboxProjectStatus,
} from "../_lib/view-models";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import { StatusBadge } from "@/components/ui/status-badge";
import { PROJECT_STATUS_BADGE } from "@/app/_lib/design-tokens";
import { ExternalLink } from "lucide-react";
import {
  LAYOUT,
  SPACING,
  TONE_CLASSES,
  TYPE,
} from "@/app/_lib/design-tokens-v2";

import {
  CalendarIcon,
  MailIcon,
  PanelRightCloseIcon,
  PhoneIcon
} from "./icons";

interface RailProps {
  readonly contact: InboxContactSummaryViewModel;
  readonly onClose?: () => void;
}

const ACTIVITY_COLLAPSED_LIMIT = 5;

/**
 * Renders contact reference data for the detail workspace.
 *
 * Header: name + record ID (mono, dim). Then contact details (with phone
 * fallback), active and past project participations, and milestone activity.
 * Visibility is controlled by the parent detail component via conditional
 * render.
 */
export function InboxContactRail({ contact, onClose }: RailProps) {
  const [activityExpanded, setActivityExpanded] = useState(false);
  const visibleActivity = activityExpanded
    ? contact.recentActivity
    : contact.recentActivity.slice(0, ACTIVITY_COLLAPSED_LIMIT);

  return (
    <aside
      id="inbox-contact-rail"
      className={`flex h-full min-h-0 ${LAYOUT.railWidth} shrink-0 flex-col ${TONE_CLASSES.slate.subtle}`}
      aria-label="Contact details"
    >
      <header className={`flex ${LAYOUT.headerHeight} shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-5`}>
        <div className="min-w-0 flex-1">
          <h2 className={`truncate ${TYPE.headingSm}`}>
            {contact.displayName}
          </h2>
          <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
            {contact.volunteerId}
          </p>
        </div>
        {onClose ? (
          <Button
            variant="outline"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Collapse contact details"
            onClick={onClose}
          >
            <PanelRightCloseIcon className="size-4" />
          </Button>
        ) : null}
      </header>

      <section
        className={`shrink-0 border-b border-slate-200 bg-white ${SPACING.section}`}
      >
        <SectionLabel as="h3">
          Contact
        </SectionLabel>
        <dl className="mt-2 space-y-1.5 text-[13px]">
          {contact.primaryEmail ? (
            <ContactLine icon={<MailIcon className="size-3.5" />}>
              {contact.primaryEmail}
            </ContactLine>
          ) : null}
          {contact.primaryPhone ? (
            <ContactLine icon={<PhoneIcon className="size-3.5" />}>
              {contact.primaryPhone}
            </ContactLine>
          ) : (
            <ContactLine
              icon={<PhoneIcon className="size-3.5" />}
              muted
            >
              No phone on file
            </ContactLine>
          )}
          <ContactLine icon={<CalendarIcon className="size-3.5" />}>
            {contact.joinedAtLabel}
          </ContactLine>
        </dl>
      </section>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ProjectsSection
          title="Active Projects"
          projects={contact.activeProjects}
          emptyLabel="No active projects"
        />
        <ProjectsSection
          title="Past Projects"
          projects={contact.pastProjects}
          emptyLabel="No past projects"
        />

        <section className={SPACING.section}>
          <SectionLabel as="h3">
            Project activity
          </SectionLabel>
          {contact.recentActivity.length === 0 ? (
            <p className="mt-2 text-[12px] text-slate-400">
              No project activity recorded.
            </p>
          ) : (
            <>
              <ul className="mt-3 space-y-3">
                {(() => {
                  const hasExplicitMostRecent = contact.recentActivity.some(
                    (entry) => entry.isMostRecent === true,
                  );
                  return visibleActivity.map((entry, index) => {
                    const isMostRecent = hasExplicitMostRecent
                      ? entry.isMostRecent === true
                      : index === 0;

                  return (
                    <li key={entry.id} className="relative flex gap-3 pb-1 last:pb-0">
                    {/* Vertical connector line — passes through dot center (5px) */}
                      {index < visibleActivity.length - 1 ? (
                        <div className="absolute left-[5px] top-3 h-full w-px bg-slate-200" />
                      ) : null}
                      {/* Dot — h-[10px] w-[10px] centers at 5px to match line */}
                      <div
                        className={`relative mt-1.5 h-[10px] w-[10px] shrink-0 rounded-full border-2 ${
                          isMostRecent
                            ? `border-sky-500 ${TONE_CLASSES.sky.dot}`
                            : "border-slate-300 bg-white"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] leading-snug text-slate-700">
                          {entry.label}
                        </p>
                        <p
                          className={`text-[11px] ${
                            isMostRecent ? "text-slate-700" : "text-slate-400"
                          }`}
                        >
                          {entry.occurredAtLabel}
                        </p>
                      </div>
                    </li>
                  );
                });
                })()}
              </ul>
              {contact.recentActivity.length > ACTIVITY_COLLAPSED_LIMIT ? (
                <button
                  type="button"
                  onClick={() => {
                    setActivityExpanded((value) => !value);
                  }}
                  className="mt-2 text-[12px] font-medium text-slate-500 transition-colors duration-150 hover:text-slate-700"
                >
                  {activityExpanded
                    ? "Show less"
                    : `Show all (${contact.recentActivity.length.toString()})`}
                </button>
              ) : null}
            </>
          )}
        </section>
      </div>
    </aside>
  );
}

interface ProjectsSectionProps {
  readonly title: string;
  readonly projects: readonly InboxProjectMembershipViewModel[];
  readonly emptyLabel: string;
}

function ProjectsSection({ title, projects, emptyLabel }: ProjectsSectionProps) {
  return (
    <section className={`border-b border-slate-200 ${SPACING.section}`}>
      <SectionLabel as="h3">
        {title}
      </SectionLabel>
      {projects.length === 0 ? (
        <p className="mt-2 text-[12px] text-slate-400">{emptyLabel}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {projects.map((project) => {
            const rowClassName =
              "group flex items-center gap-2 rounded-lg px-2 py-1.5 transition";
            const isClickable = project.expeditionMemberUrl !== null;
            const content = (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-slate-800 group-hover:text-slate-900">
                    {project.projectName}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <InboxProjectStatusBadge
                      status={project.status}
                      label={project.statusLabel}
                    />
                  </p>
                </div>
                {isClickable ? (
                  <ExternalLink
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-slate-400 opacity-0 transition group-hover:opacity-100"
                  />
                ) : null}
              </>
            );

            return (
              <li key={project.membershipId}>
                {!isClickable ? (
                  <div className={rowClassName}>{content}</div>
                ) : (
                  <a
                    href={project.expeditionMemberUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`${rowClassName} hover:bg-white hover:ring-1 hover:ring-slate-200`}
                    aria-label={`Open ${project.projectName} expedition member record in Salesforce`}
                  >
                    {content}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function InboxProjectStatusBadge({
  status,
  label,
}: {
  readonly status: InboxProjectStatus;
  readonly label: string;
}) {
  return (
    <StatusBadge
      variant="subtle"
      colorClasses={PROJECT_STATUS_BADGE[status]}
      label={label}
    />
  );
}

function ContactLine({
  icon,
  children,
  muted = false
}: {
  readonly icon: React.ReactNode;
  readonly children: React.ReactNode;
  readonly muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 ${muted ? "italic text-slate-400" : "text-slate-700"}`}
    >
      <span className={muted ? "text-slate-300" : "text-slate-300"}>{icon}</span>
      <span className="truncate">{children}</span>
    </div>
  );
}
