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
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mt-3">{children}</div>
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
    <div className="grid gap-1.5 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="text-[12.5px] text-slate-700">{value}</div>
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
        <div className="space-y-2 text-[12.5px] leading-6 text-slate-600">
          <p>Email content not retained from Mailchimp import.</p>
          <p>
            We have the campaign metadata + per-recipient engagement, but the
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
          <SummaryRow label="Preview" value={preheader} />
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
        <div className="space-y-2 text-[12.5px] leading-6 text-slate-600">
          <p>Mailchimp historical audience.</p>
          <p>
            The audience list was managed externally in Mailchimp; criteria were
            not captured.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Audience criteria">
      <pre className="max-h-[260px] overflow-x-auto rounded-lg bg-slate-950 px-3 py-3 text-[11px] leading-5 text-slate-100">
        {JSON.stringify(model.audienceCriteria, null, 2)}
      </pre>
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
