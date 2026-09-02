import type { ReactNode } from "react";

import type { RunDetailModel } from "../_lib/run-detail";
import { LocalDateTime } from "./local-date-time";

export function Panel({
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

function formatRate(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function EmailContentPanel({
  model,
}: {
  readonly model: RunDetailModel;
}) {
  if (model.channel === "sms") {
    const bodyText = model.run.bodyTextTemplate?.trim() ?? "";

    return (
      <Panel title="Message">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-[12.5px] leading-6 text-slate-700 whitespace-pre-wrap">
          {bodyText.length > 0
            ? bodyText
            : "No message body was saved for this run."}
        </div>
      </Panel>
    );
  }

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
  const bodyHtml = model.run.bodyHtmlTemplate?.trim() ?? "";
  const bodyText = model.run.bodyTextTemplate?.trim() ?? "";

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
        {bodyHtml.length > 0 ? (
          <div className="space-y-1.5">
            {/*
              Render the stored HTML visually in a sandboxed iframe (same
              approach as the compose preview step). Merge tags like
              {{firstName}} are the send-time template, so they show
              unrendered here — layout/styling is what matters on this view.
            */}
            <iframe
              title="Email body"
              srcDoc={bodyHtml}
              className="block w-full rounded-lg border border-slate-200 bg-white"
              style={{ height: 640 }}
              sandbox="allow-same-origin"
            />
            <p className="text-[11px] text-slate-400">
              Rendered from the sent HTML. Merge tags (e.g. {"{{firstName}}"})
              appear unrendered.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-[12.5px] leading-6 text-slate-700 whitespace-pre-wrap">
            {bodyText.length > 0
              ? bodyText
              : "No message body was saved for this run."}
          </div>
        )}
      </div>
    </Panel>
  );
}

export function SubjectVariantBreakdownPanel({
  model,
}: {
  readonly model: RunDetailModel;
}) {
  if (
    model.channel === "sms" ||
    model.provider === "mailchimp" ||
    !model.run.abTestEnabled ||
    model.subjectVariantBreakdown === null
  ) {
    return null;
  }

  return (
    <Panel title="Subject variants">
      <div className="grid gap-3 md:grid-cols-2">
        {model.subjectVariantBreakdown.map((variant) => (
          <section
            key={variant.variant}
            className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50/40"
          >
            <div className="border-b border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Variant {variant.label}
                </h3>
                <span className="font-mono text-[10.5px] tabular-nums text-slate-500">
                  {variant.assigned.toLocaleString()} recipients
                </span>
              </div>
              <p className="mt-2 text-[13px] font-medium leading-5 text-slate-900">
                {variant.subject ?? "(no subject)"}
              </p>
            </div>
            <dl className="grid grid-cols-3 gap-px bg-slate-200">
              {[
                {
                  label: "Delivered",
                  count: variant.delivered,
                  rate: variant.deliveredRate,
                },
                {
                  label: "Opened",
                  count: variant.opened,
                  rate: variant.openedRate,
                },
                {
                  label: "Clicked",
                  count: variant.clicked,
                  rate: variant.clickedRate,
                },
              ].map((metric) => (
                <div key={metric.label} className="bg-white px-4 py-3">
                  <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
                    {metric.label}
                  </dt>
                  <dd className="mt-1 text-[14px] font-semibold tabular-nums text-slate-900">
                    {metric.count.toLocaleString()}
                  </dd>
                  <p className="mt-1 text-[11px] tabular-nums text-slate-500">
                    {formatRate(metric.rate)}
                  </p>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Panel>
  );
}

export function BotActivityPanel({
  model,
}: {
  readonly model: RunDetailModel;
}) {
  if (
    model.channel === "sms" ||
    model.provider === "mailchimp" ||
    (!model.botActivity.opens.hasEventData &&
      !model.botActivity.clicks.hasEventData)
  ) {
    return null;
  }

  const channels = [
    {
      label: "Opens",
      activity: model.botActivity.opens,
    },
    {
      label: "Clicks",
      activity: model.botActivity.clicks,
    },
  ].filter((entry) => entry.activity.hasEventData);

  return (
    <Panel title="Bot & scanner activity">
      <div className="space-y-3">
        {channels.map((entry) => {
          const total = entry.activity.human + entry.activity.bot;

          return (
            <section
              key={entry.label}
              className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50/40"
            >
              <div className="border-b border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {entry.label}
                  </h3>
                  <span className="font-mono text-[10.5px] tabular-nums text-slate-500">
                    {total.toLocaleString()} total
                  </span>
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-px bg-slate-200">
                {[
                  { label: "Real", count: entry.activity.human },
                  {
                    label: "Bot / scanner",
                    count: entry.activity.bot,
                  },
                  { label: "Total", count: total },
                ].map((metric) => (
                  <div key={metric.label} className="bg-white px-4 py-3">
                    <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
                      {metric.label}
                    </dt>
                    <dd className="mt-1 text-[14px] font-semibold tabular-nums text-slate-900">
                      {metric.count.toLocaleString()}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
        <p className="text-[11px] text-slate-500">
          Headline Opened and Clicked counts already exclude identified bot /
          scanner activity. Open detection only covers sends after per-open
          tracking went live, and some privacy-proxy opens like Apple Mail
          Privacy Protection cannot be fully identified.
        </p>
      </div>
    </Panel>
  );
}

export function LinkClicksPanel({
  model,
}: {
  readonly model: RunDetailModel;
}) {
  if (model.channel === "sms") {
    return null;
  }

  if (model.provider === "mailchimp") {
    return (
      <Panel title="Link clicks">
        <div className="space-y-2 text-[12.5px] leading-6 text-pretty text-slate-600">
          <p>Link clicks are not available for Mailchimp imports.</p>
        </div>
      </Panel>
    );
  }

  if (model.linkClicks.length === 0) {
    return (
      <Panel title="Link clicks">
        <div className="space-y-2 text-[12.5px] leading-6 text-pretty text-slate-600">
          <p>No link clicks recorded yet.</p>
          <p>Only broadcasts sent after link tracking went live have data.</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Link clicks">
      <ul className="divide-y divide-slate-100">
        {model.linkClicks.map((entry) => (
          <li
            key={entry.url}
            className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
          >
            <a
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 break-all text-[12px] font-medium text-slate-900 hover:text-slate-700"
            >
              {entry.url}
            </a>
            <div className="shrink-0 text-right">
              <div className="text-[12px] font-medium tabular-nums text-slate-900">
                {entry.totalClicks.toLocaleString()} clicks
              </div>
              <div className="text-[11px] tabular-nums text-slate-500">
                {entry.uniqueClickers.toLocaleString()} unique
              </div>
              {entry.botClicks > 0 ? (
                <div className="text-[11px] tabular-nums text-slate-500">
                  {entry.botClicks.toLocaleString()} bot
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
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
        {model.channel === "sms" ? null : (
          <SummaryRow label="From" value={fromLabel} />
        )}
        {model.channel === "sms" ? null : (
          <SummaryRow label="Reply-to" value={replyToLabel} />
        )}
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
