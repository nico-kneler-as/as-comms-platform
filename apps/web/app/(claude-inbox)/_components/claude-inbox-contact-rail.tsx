import type { ClaudeContactSummaryViewModel } from "../_lib/view-models";
import { ClaudeInboxAvatar } from "./claude-inbox-avatar";
import { ClaudeStageBadge } from "./claude-inbox-badge";
import { ClaudeInboxChip } from "./claude-inbox-chip";
import {
  CalendarIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon
} from "./claude-icons";

interface RailProps {
  readonly contact: ClaudeContactSummaryViewModel;
}

export function ClaudeInboxContactRail({ contact }: RailProps) {
  return (
    <aside
      className="hidden w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-slate-50/40 xl:flex"
      aria-label="Contact context"
    >
      <div className="flex flex-col items-center gap-3 border-b border-slate-200 bg-white px-6 py-6 text-center">
        <ClaudeInboxAvatar
          initials={contact.initials}
          tone={contact.avatarTone}
          size="lg"
        />
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {contact.displayName}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">{contact.joinedAtLabel}</p>
        </div>
        <ClaudeStageBadge stage={contact.volunteerStage} />
        {contact.contextChips.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-1.5">
            {contact.contextChips.map((chip) => (
              <ClaudeInboxChip key={chip.id} tone={chip.tone}>
                {chip.label}
              </ClaudeInboxChip>
            ))}
          </div>
        ) : null}
      </div>

      <section className="border-b border-slate-200 px-6 py-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Contact
        </h3>
        <dl className="mt-3 space-y-2 text-sm">
          {contact.primaryEmail ? (
            <ContactLine icon={<MailIcon className="h-4 w-4" />}>
              {contact.primaryEmail}
            </ContactLine>
          ) : null}
          {contact.primaryPhone ? (
            <ContactLine icon={<PhoneIcon className="h-4 w-4" />}>
              {contact.primaryPhone}
            </ContactLine>
          ) : null}
          {contact.location ? (
            <ContactLine icon={<MapPinIcon className="h-4 w-4" />}>
              {contact.location}
            </ContactLine>
          ) : null}
          <ContactLine icon={<CalendarIcon className="h-4 w-4" />}>
            {contact.joinedAtLabel}
          </ContactLine>
        </dl>
      </section>

      {contact.projects.length > 0 ? (
        <section className="border-b border-slate-200 px-6 py-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Projects
          </h3>
          <ul className="mt-3 space-y-3">
            {contact.projects.map((project) => (
              <li key={project.projectId} className="text-sm">
                <p className="font-medium text-slate-900">
                  {project.projectName}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {project.role} · {project.status}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {contact.recentActivity.length > 0 ? (
        <section className="px-6 py-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Recent activity
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            {contact.recentActivity.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 text-slate-600"
              >
                <span className="truncate">{entry.label}</span>
                <span className="shrink-0 text-xs text-slate-400">
                  {entry.occurredAtLabel}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
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
