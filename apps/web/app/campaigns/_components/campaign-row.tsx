import Link from "next/link";
import { Mail, Megaphone, Users } from "lucide-react";

import type { CampaignRunProjectionRow } from "@as-comms/contracts";
import { ORG_TIMEZONE } from "@/app/_lib/org-timezone";
import { cn } from "@/lib/utils";

import { ProviderBadge } from "./provider-badge";

const CAMPAIGN_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "2-digit",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: ORG_TIMEZONE,
});

const CAMPAIGN_DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  timeZone: ORG_TIMEZONE,
});

function resolveStatusClasses(state: CampaignRunProjectionRow["state"]) {
  switch (state) {
    case "complete":
      return "bg-sky-50 text-sky-700";
    case "finalized":
      return "bg-slate-50 text-slate-600";
    case "sending":
      return "bg-emerald-50 text-emerald-700";
    case "draft":
      return "bg-amber-50 text-amber-700";
    case "scheduled":
      return "bg-violet-50 text-violet-700";
    case "cancelled":
      return "bg-rose-50 text-rose-700";
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

  return `${input.audienceSize.toLocaleString()} recipients`;
}

function readTypeMeta(item: CampaignRowViewModel) {
  if (item.audienceType === "newsletter") {
    return {
      Icon: Megaphone,
      label: "Newsletter",
      className: resolveStatusClasses(item.state),
    };
  }

  if (item.audienceType === "specific") {
    return {
      Icon: Users,
      label: "Specific volunteers",
      className: resolveStatusClasses(item.state),
    };
  }

  return {
    Icon: Mail,
    label: "Project",
    className: resolveStatusClasses(item.state),
  };
}

function formatDateTimeLabel(value: string) {
  const [monthDay = "", time = "12:00am"] = CAMPAIGN_DATE_TIME_FORMATTER.format(
    new Date(value),
  ).split(" at ");
  return `${monthDay} at ${time.replace(" ", "").toLowerCase()}`;
}

function formatCampaignTimestamp(item: CampaignRowViewModel) {
  switch (item.state) {
    case "complete":
    case "finalized":
      return `Sent on ${formatDateTimeLabel(item.completedAt ?? item.updatedAt)}`;
    case "scheduled":
      return `Scheduled for ${formatDateTimeLabel(item.scheduledAt ?? item.createdAt)} MT`;
    case "sending":
      return `Started ${CAMPAIGN_DAY_FORMATTER.format(new Date(item.startedAt ?? item.createdAt))}`;
    case "cancelled":
      return `Cancelled ${CAMPAIGN_DAY_FORMATTER.format(new Date(item.cancelledAt ?? item.updatedAt))}`;
    case "draft":
      return `Saved ${CAMPAIGN_DAY_FORMATTER.format(new Date(item.updatedAt))}`;
  }
}

export interface CampaignRowViewModel {
  readonly runId: string;
  readonly provider: "postmark" | "mailchimp";
  readonly name: string | null;
  readonly kind: CampaignRunProjectionRow["kind"];
  readonly launchType: CampaignRunProjectionRow["launchType"];
  readonly state: CampaignRunProjectionRow["state"];
  readonly audienceType: "newsletter" | "project" | "specific";
  readonly projectId: string | null;
  readonly projectAlias: string | null;
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
    item.name?.trim().length && item.name.trim().length > 0
      ? item.name
      : "No subject yet";
  const secondaryText = item.subject.trim().length
    ? item.subject
    : item.previewText?.trim().length
      ? item.previewText
      : item.provider === "mailchimp"
        ? "Historical Mailchimp campaign"
        : "";
  const href =
    item.provider === "mailchimp"
      ? `/campaigns/${encodeURIComponent(item.runId)}?provider=mailchimp`
      : `/campaigns/${encodeURIComponent(item.runId)}`;
  const typeMeta = readTypeMeta(item);
  const TypeIcon = typeMeta.Icon;
  const projectAliasTag = item.projectAlias?.trim().length
    ? `${item.projectAlias.trim()}@`
    : null;

  return (
    <div style={style}>
      <Link
        href={href}
        prefetch={false}
        data-campaign-row="true"
        data-campaign-provider={item.provider}
        data-campaign-state={item.state}
        className="grid min-h-[92px] grid-cols-[40px_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-3 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400 sm:min-h-0 sm:grid-cols-[40px_minmax(0,1fr)_minmax(150px,190px)] sm:items-center sm:gap-4"
      >
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-lg",
            typeMeta.className,
          )}
          title={typeMeta.label}
        >
          <TypeIcon className="size-4" aria-hidden="true" />
        </span>

        <div className="min-w-0">
          <p
            className={cn(
              "truncate text-[13.5px] font-semibold leading-5 text-slate-900",
              item.name?.trim().length ? "" : "italic text-slate-500",
            )}
          >
            {title}
          </p>

          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] leading-4 text-slate-500">
            {projectAliasTag ? (
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-600">
                {projectAliasTag}
              </span>
            ) : null}
            {item.provider === "mailchimp" ? (
              <ProviderBadge
                provider={item.provider}
                className="bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500 ring-slate-200/80"
              />
            ) : null}
            <p className="truncate">{secondaryText}</p>
          </div>
        </div>

        <div className="col-span-2 min-w-0 text-left sm:col-span-1 sm:text-right">
          <p className="truncate text-[12.5px] font-medium text-slate-900">
            {formatAudienceLabel(item)}
          </p>
          <p className="mt-0.5 truncate text-[12px] leading-4 text-slate-500">
            {formatCampaignTimestamp(item)}
          </p>
        </div>
      </Link>
    </div>
  );
}
