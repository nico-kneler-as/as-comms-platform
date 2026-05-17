import Link from "next/link";

import type { CampaignRunProjectionRow } from "@as-comms/contracts";

import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

import { MailIcon } from "@/app/inbox/_components/icons";

import { ProviderBadge } from "./provider-badge";

const CAMPAIGN_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/Denver",
});

function formatCampaignDate(input: {
  readonly state: CampaignRunProjectionRow["state"];
  readonly scheduledAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
}) {
  const dateValue =
    input.state === "scheduled"
      ? input.scheduledAt
      : (input.cancelledAt ??
        input.completedAt ??
        input.startedAt ??
        input.scheduledAt ??
        input.createdAt);
  const label =
    input.state === "scheduled"
      ? "Scheduled"
      : input.state === "cancelled"
        ? "Cancelled"
        : "Sent";

  const safeDateValue = dateValue ?? input.createdAt;

  return `${label} ${CAMPAIGN_DATE_FORMATTER.format(new Date(safeDateValue))}`;
}

function resolveStateColor(state: CampaignRunProjectionRow["state"]) {
  switch (state) {
    case "draft":
      return "bg-slate-400";
    case "scheduled":
      return "bg-amber-500";
    case "sending":
      return "bg-sky-500";
    case "complete":
      return "bg-emerald-500";
    case "finalized":
      return "bg-emerald-700";
    case "cancelled":
      return "bg-rose-500";
  }
}

function resolveStateBadgeClasses(state: CampaignRunProjectionRow["state"]) {
  switch (state) {
    case "draft":
      return "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200";
    case "scheduled":
      return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
    case "sending":
      return "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200";
    case "complete":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200";
    case "finalized":
      return "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-300";
    case "cancelled":
      return "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200";
  }
}

function formatAudienceLabel(input: {
  readonly provider: "postmark" | "mailchimp";
  readonly audienceSize: number | null;
  readonly state: CampaignRunProjectionRow["state"];
}) {
  if (input.audienceSize === null) {
    return input.provider === "mailchimp"
      ? "Historical Mailchimp import"
      : "Audience pending";
  }

  const count = input.audienceSize.toLocaleString();
  if (input.state === "complete" || input.state === "finalized") {
    return `${count} sent`;
  }

  return `${count} recipients`;
}

export interface CampaignRowViewModel {
  readonly runId: string;
  readonly provider: "postmark" | "mailchimp";
  readonly kind: CampaignRunProjectionRow["kind"];
  readonly launchType: CampaignRunProjectionRow["launchType"];
  readonly state: CampaignRunProjectionRow["state"];
  readonly projectId: string | null;
  readonly projectLabel: string | null;
  readonly sender: string;
  readonly subject: string;
  readonly previewText: string | null;
  readonly audienceSize: number | null;
  readonly scheduledAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function CampaignRow({
  item,
  style,
}: {
  readonly item: CampaignRowViewModel;
  readonly style?: React.CSSProperties;
}) {
  const title =
    item.subject.trim().length === 0 ? "No subject yet" : item.subject;
  const previewText = item.previewText?.trim().length
    ? item.previewText
    : item.provider === "mailchimp"
      ? "Historical Mailchimp campaign"
      : "No preview text";
  const href =
    item.provider === "mailchimp"
      ? `/campaigns/${encodeURIComponent(item.runId)}?provider=mailchimp`
      : `/campaigns/${encodeURIComponent(item.runId)}`;

  return (
    <div style={style}>
      <Link
        href={href}
        prefetch={false}
        data-campaign-row="true"
        data-campaign-provider={item.provider}
        data-campaign-state={item.state}
        className="grid min-h-[156px] grid-cols-[44px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 border-b border-slate-200 bg-white px-5 py-4 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400 sm:h-[92px] sm:min-h-0 sm:grid-cols-[44px_minmax(0,1fr)_minmax(132px,180px)] sm:gap-5 sm:px-6 sm:py-0"
      >
        <span className="flex size-11 items-center justify-center rounded-lg border border-sky-100 bg-sky-50 text-sky-700">
          <MailIcon className="size-4" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-base font-semibold leading-6 text-slate-900",
              item.state === "draft" && item.subject.trim().length === 0
                ? "italic text-slate-500"
                : "",
            )}
          >
            {title}
          </p>

          <div className="mt-1 flex min-w-0 items-center gap-2 text-sm text-slate-500">
            {item.projectLabel ? (
              <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                {item.projectLabel}
              </span>
            ) : null}
            <p className="truncate">{previewText}</p>
          </div>

          <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-slate-500">
            <Chip tone="neutral">
              {item.kind === "project" ? "Project" : "Newsletter"}
            </Chip>
            {item.sender.trim().length > 0 ? (
              <span className="truncate text-slate-400">{item.sender}</span>
            ) : null}
            <span className="truncate">{formatAudienceLabel(item)}</span>
          </div>
        </div>

        <div className="col-span-2 min-w-0 text-left sm:col-span-1 sm:text-right">
          <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
                resolveStateBadgeClasses(item.state),
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  resolveStateColor(item.state),
                )}
              />
              {item.state}
            </span>
            <ProviderBadge provider={item.provider} />
          </div>
          <p className="mt-2 truncate text-sm text-slate-500">
            {formatCampaignDate(item)}
          </p>
        </div>
      </Link>
    </div>
  );
}
