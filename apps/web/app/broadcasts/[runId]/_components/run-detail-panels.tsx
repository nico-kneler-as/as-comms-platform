import type { ReactNode } from "react";

import type { RunDetailModel } from "../_lib/run-detail";
import { LocalDateTime } from "./local-date-time";

function Panel({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
          {title}
        </h2>
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function SummaryRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="text-right text-[12px] text-slate-700">{value}</span>
    </div>
  );
}

export function EmailContentPanel({
  model,
}: {
  readonly model: RunDetailModel;
}) {
  if (model.provider === "mailchimp") {
    return (
      <Panel title="Email content">
        <div className="space-y-2 text-[12.5px] leading-6 text-pretty text-slate-600">
          <p>Email content not retained from Mailchimp import.</p>
          <p>
            We have the broadcast metadata + per-recipient engagement, but the
            original HTML body is not stored on our side.
          </p>
        </div>
      </Panel>
    );
  }

  const subject = model.run.subjectTemplate?.trim() ?? "";
  const preheader = model.run.preheader?.trim() ?? "";
  const body =
    model.run.bodyTextTemplate?.trim() ??
    (model.run.bodyHtmlTemplate === null ? "" : "HTML content available.");

  return (
    <Panel title="Email content">
      <div className="space-y-3">
        <SummaryRow
          label="Subject"
          value={
            subject.length > 0 ? (
              <span className="font-medium text-slate-900">{subject}</span>
            ) : (
              <span className="italic text-slate-500">(no subject)</span>
            )
          }
        />
        {preheader.length > 0 ? (
          <SummaryRow label="Preheader" value={preheader} />
        ) : null}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-[12.5px] leading-6 text-slate-700 whitespace-pre-wrap">
          {body.length > 0 ? body : "No message body was saved for this run."}
        </div>
      </div>
    </Panel>
  );
}

export function AudienceCriteriaPanel({
  model,
}: {
  readonly model: RunDetailModel;
}) {
  if (model.provider === "mailchimp") {
    return (
      <Panel title="Audience criteria">
        <div className="space-y-2 text-[12.5px] leading-6 text-pretty text-slate-600">
          <p>Mailchimp historical audience.</p>
          <p>
            The audience list was managed externally in Mailchimp; criteria were
            not captured.
          </p>
        </div>
      </Panel>
    );
  }

  const {
    criteria,
    projectNames,
    statusLabels,
    contactCount,
    expeditionCount,
  } = getAudienceCriteriaSummary(model);

  return (
    <Panel title="Audience criteria">
      <dl className="space-y-1">
        <SummaryRow
          label="Projects"
          value={projectNames.length > 0 ? projectNames.join(", ") : "—"}
        />
        <SummaryRow
          label="Statuses"
          value={statusLabels.length > 0 ? statusLabels.join(", ") : "All"}
        />
        <SummaryRow
          label="Contacts"
          value={contactCount > 0 ? contactCount.toLocaleString() : "—"}
        />
        <SummaryRow
          label="Expeditions"
          value={expeditionCount > 0 ? expeditionCount.toLocaleString() : "—"}
        />
        <SummaryRow
          label="Last activity"
          value={humanizeLastActivity(criteria.lastActivityWindow)}
        />
        <SummaryRow
          label="Has replied"
          value={humanizeTriState(criteria.hasReplied)}
        />
        <SummaryRow
          label="Has clicked"
          value={humanizeTriState(criteria.hasClicked)}
        />
      </dl>
    </Panel>
  );
}

export function SendDetailsPanel({
  model,
}: {
  readonly model: RunDetailModel;
}) {
  const sendDateLabel =
    model.provider === "mailchimp"
      ? "Sent at"
      : model.run.state === "scheduled"
        ? "Scheduled for"
        : model.run.state === "draft"
          ? "Saved at"
          : "Sent at";
  const sendDateIso =
    model.provider === "mailchimp"
      ? model.run.startedAt ?? model.run.completedAt ?? model.run.createdAt
      : model.run.startedAt ??
        model.run.scheduledAt ??
        model.run.completedAt ??
        model.run.createdAt;
  const fromLabel =
    model.provider === "mailchimp"
      ? "Mailchimp"
      : model.run.fromName?.trim() && model.run.fromEmail
        ? `${model.run.fromName.trim()} <${model.run.fromEmail}>`
        : model.run.fromEmail ?? "n/a";
  const replyToLabel =
    model.provider === "mailchimp" ? "n/a" : (model.run.replyToEmail ?? "n/a");
  const audienceLabel =
    model.provider === "mailchimp"
      ? `${model.totalAudience.toLocaleString()} recipients (Mailchimp historical)`
      : `${model.totalAudience.toLocaleString()} recipients`;
  const autoExcludedLabel =
    model.provider === "mailchimp"
      ? "n/a (not tracked for imports)"
      : "Applied in the frozen audience snapshot";

  return (
    <Panel title="Send details">
      <div className="space-y-3">
        <SummaryRow
          label={sendDateLabel}
          value={<LocalDateTime iso={sendDateIso} />}
        />
        <SummaryRow label="From" value={fromLabel} />
        <SummaryRow label="Reply-to" value={replyToLabel} />
        <SummaryRow label="Audience" value={audienceLabel} />
        <SummaryRow label="Auto-excluded" value={autoExcludedLabel} />
      </div>
    </Panel>
  );
}

function humanizeStatus(status: string): string {
  if (status.length === 0) {
    return status;
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

function humanizeTriState(value: string | null | undefined): string {
  if (value === "yes") {
    return "Yes";
  }
  if (value === "no") {
    return "No";
  }
  return "Any";
}

function humanizeLastActivity(window: string | null | undefined): string {
  switch (window) {
    case "last_30_days":
      return "Last 30 days";
    case "last_90_days":
      return "Last 90 days";
    case "last_year":
      return "Last year";
    case "all_time":
    default:
      return "Any time";
  }
}

function getAudienceCriteriaSummary(model: RunDetailModel) {
  const criteria = model.audienceCriteria;
  const projectLabelsById = model.projectLabelsById ?? {};
  const projectNames = criteria.projectIds
    .map((id) => projectLabelsById[id] ?? id)
    .filter((name, index, values) => values.indexOf(name) === index);
  const statusLabels = criteria.statuses.map(humanizeStatus);
  const contactCount = criteria.contactIds?.length ?? 0;
  const expeditionCount = criteria.expeditionIds.length;

  return {
    criteria,
    projectNames,
    statusLabels,
    contactCount,
    expeditionCount,
  };
}
