import type {
  InboxContactSummaryViewModel,
  InboxProjectMembershipViewModel,
  InboxProjectStatus
} from "../_lib/view-models";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  LAYOUT,
  PROJECT_STATUS_BADGE,
  TEXT,
  TONE,
  SPACING,
} from "@/app/_lib/design-tokens";

import {
  CalendarIcon,
  ChevronRightIcon,
  MailIcon,
  MapPinIcon,
  PanelRightCloseIcon,
  PhoneIcon
} from "./icons";

interface RailProps {
  readonly contact: InboxContactSummaryViewModel;
  readonly onClose?: () => void;
}

/**
 * Server component: renders contact reference data for the detail workspace.
 *
 * Starts with a minimal name + record ID header (no avatar placeholder,
 * no stage badge), then contact details, active and past project
 * participations, and milestone activity. Visibility is controlled by the
 * parent detail component via conditional render.
 */
export function InboxContactRail({ contact, onClose }: RailProps) {
  return (
    <aside
      id="inbox-contact-rail"
      className={`flex min-h-0 ${LAYOUT.railWidth} shrink-0 flex-col ${TONE.slate.subtle}`}
      aria-label="Contact details"
    >
      <header className={`flex ${LAYOUT.headerHeight} shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-5`}>
        <div className="min-w-0 flex-1">
          <h2 className={`truncate ${TEXT.headingSm}`}>
            {contact.displayName}
          </h2>
          <p className={`mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500`}>
            Record ID · {contact.volunteerId}
          </p>
        </div>
        {onClose ? (
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Collapse contact details"
            onClick={onClose}
          >
            <PanelRightCloseIcon className="h-4 w-4" />
          </Button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
      <section className={`border-b border-slate-200 ${SPACING.section}`}>
        <SectionLabel>
          Contact
        </SectionLabel>
        <dl className="mt-2 space-y-1.5 text-[13px]">
          {contact.primaryEmail ? (
            <ContactLine icon={<MailIcon className="h-3.5 w-3.5" />}>
              {contact.primaryEmail}
            </ContactLine>
          ) : null}
          {contact.primaryPhone ? (
            <ContactLine icon={<PhoneIcon className="h-3.5 w-3.5" />}>
              {contact.primaryPhone}
            </ContactLine>
          ) : null}
          {contact.cityState ? (
            <ContactLine icon={<MapPinIcon className="h-3.5 w-3.5" />}>
              {contact.cityState}
            </ContactLine>
          ) : null}
          <ContactLine icon={<CalendarIcon className="h-3.5 w-3.5" />}>
            {contact.joinedAtLabel}
          </ContactLine>
        </dl>
      </section>

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
        <SectionLabel>
          Project activity
        </SectionLabel>
        {contact.recentActivity.length === 0 ? (
          <p className="mt-2 text-[12px] text-slate-400">
            No project activity recorded.
          </p>
        ) : (
          <ul className="mt-3 space-y-0">
            {contact.recentActivity.map((entry, index) => (
              <li
                key={entry.id}
                className="relative flex gap-3 pb-4 last:pb-0"
              >
                {/* Vertical connector line */}
                {index < contact.recentActivity.length - 1 ? (
                  <div className="absolute left-[5px] top-3 h-full w-px bg-slate-200" />
                ) : null}
                {/* Dot */}
                <div className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-slate-300 bg-white" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug text-slate-700">
                    {entry.label}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {entry.occurredAtLabel}
                  </p>
                </div>
              </li>
            ))}
          </ul>
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
      <h3 className={TEXT.label}>
        {title}
      </h3>
      {projects.length === 0 ? (
        <p className="mt-2 text-[12px] text-slate-400">{emptyLabel}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {projects.map((project) => (
            <li key={project.membershipId}>
              <a
                href={project.crmUrl}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-white hover:ring-1 hover:ring-slate-200"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-slate-800 group-hover:text-slate-900">
                    {project.projectName}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="tabular-nums">
                      {project.year.toString()}
                    </span>
                    <span className="text-slate-300">·</span>
                    <InboxProjectStatusBadge status={project.status} />
                  </p>
                </div>
                <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-500" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const PROJECT_STATUS_LABEL: Record<InboxProjectStatus, string> = {
  lead: "Lead",
  applied: "Applied",
  "in-training": "In Training",
  "trip-planning": "Trip Planning",
  "in-field": "In the Field",
  successful: "Successful"
};

export function InboxProjectStatusBadge({
  status
}: {
  readonly status: InboxProjectStatus;
}) {
  return (
    <StatusBadge
      variant="subtle"
      colorClasses={PROJECT_STATUS_BADGE[status]}
      label={PROJECT_STATUS_LABEL[status]}
    />
  );
}

function ContactLine({
  icon,
  children
}: {
  readonly icon: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-slate-700">
      <span className="text-slate-400">{icon}</span>
      <span className="truncate">{children}</span>
    </div>
  );
}
