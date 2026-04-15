import type {
  ClaudeContactSummaryViewModel,
  ClaudeProjectMembershipViewModel,
  ClaudeProjectStatus
} from "../_lib/view-models";
import {
  CalendarIcon,
  ChevronRightIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  SparkleIcon
} from "./claude-icons";

interface RailProps {
  readonly contact: ClaudeContactSummaryViewModel;
}

/**
 * Server component: renders volunteer reference data for the detail workspace.
 *
 * Starts with a minimal name + volunteer ID header (no avatar placeholder,
 * no stage badge), then contact details, active and past project
 * participations, and milestone activity. Visibility is controlled by the
 * parent detail component via conditional render.
 */
export function ClaudeInboxContactRail({ contact }: RailProps) {
  return (
    <aside
      id="claude-inbox-contact-rail"
      className="flex min-h-0 w-80 shrink-0 flex-col border-l border-slate-200 bg-slate-50/40"
      aria-label="Volunteer details"
    >
      {/*
        The header is pinned so the volunteer's name and ID remain visible
        while the sections below scroll — contact info, every active and
        past project, and the recent-activity feed can grow well past the
        viewport for long-tenured volunteers.
      */}
      <header className="flex h-[65px] shrink-0 flex-col justify-center border-b border-slate-200 bg-white px-5">
        <h2 className="truncate text-sm font-semibold text-slate-900">
          {contact.displayName}
        </h2>
        <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Volunteer ID · {contact.volunteerId}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="border-b border-slate-200 px-5 py-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Contact
        </h3>
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

      {contact.recentActivity.length > 0 ? (
        <section className="px-5 py-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Recent activity
          </h3>
          <ul className="mt-2 space-y-2">
            {contact.recentActivity.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start gap-2 text-[13px] text-slate-600"
              >
                <span className="mt-0.5 text-slate-400">
                  <SparkleIcon className="h-3 w-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="leading-snug text-slate-700">{entry.label}</p>
                  <p className="text-[11px] text-slate-400">
                    {entry.occurredAtLabel}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      </div>
    </aside>
  );
}

interface ProjectsSectionProps {
  readonly title: string;
  readonly projects: readonly ClaudeProjectMembershipViewModel[];
  readonly emptyLabel: string;
}

function ProjectsSection({ title, projects, emptyLabel }: ProjectsSectionProps) {
  return (
    <section className="border-b border-slate-200 px-5 py-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
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
                    <ProjectStatusBadge status={project.status} />
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

const PROJECT_STATUS_STYLE: Record<ClaudeProjectStatus, string> = {
  lead: "bg-slate-100 text-slate-600",
  applied: "bg-sky-50 text-sky-700",
  "in-training": "bg-indigo-50 text-indigo-700",
  "trip-planning": "bg-amber-50 text-amber-700",
  "in-field": "bg-emerald-50 text-emerald-700",
  successful: "bg-violet-50 text-violet-700"
};

const PROJECT_STATUS_LABEL: Record<ClaudeProjectStatus, string> = {
  lead: "Lead",
  applied: "Applied",
  "in-training": "In Training",
  "trip-planning": "Trip Planning",
  "in-field": "In the Field",
  successful: "Successful"
};

export function ProjectStatusBadge({
  status
}: {
  readonly status: ClaudeProjectStatus;
}) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-medium ${PROJECT_STATUS_STYLE[status]}`}
    >
      {PROJECT_STATUS_LABEL[status]}
    </span>
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
