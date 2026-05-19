import Link from "next/link";
import { Eye, Mail, Megaphone, MessageSquare, Users } from "lucide-react";

import type { CampaignRunProjectionRow } from "@as-comms/contracts";

import { TONE_CLASSES, TYPE, FOCUS_RING, RADIUS, TRANSITION } from "@/app/_lib/design-tokens-v2";
import { ORG_TIMEZONE } from "@/app/_lib/org-timezone";
import { projectToneFromName } from "@/app/inbox/_lib/project-tone";
import { cn } from "@/lib/utils";

import { LocalDateTime } from "../[runId]/_components/local-date-time";
import { RunStateChip } from "../[runId]/_components/run-state-chip";

const ACTIVE_ACCENT_CLASS: Partial<Record<CampaignRunProjectionRow["state"], string>> =
  {
    sending: "bg-sky-500",
    scheduled: "bg-violet-500",
  };

const COMPLETE_OPEN_RATE_ICON_CLASS = "size-3 text-slate-500";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: ORG_TIMEZONE,
  timeZoneName: "short",
});

function formatCount(value: number) {
  return value.toLocaleString();
}

function resolveAudienceTotal(item: CampaignRowViewModel): number | null {
  if (item.audienceSize !== null) {
    return item.audienceSize;
  }
  if (item.sentCount !== null) {
    return item.sentCount;
  }
  return null;
}

function readTypeMeta(item: CampaignRowViewModel) {
  if (item.launchType === "html_email") {
    return {
      Icon: Megaphone,
      label: "HTML broadcast",
      className: "bg-violet-50 text-violet-600",
    };
  }

  if (item.launchType === "sms") {
    if (item.selectedContactCount > 0) {
      return {
        Icon: Users,
        label: "SMS to specific contacts",
        className: "bg-indigo-50 text-indigo-600",
      };
    }
    return {
      Icon: MessageSquare,
      label: "Project SMS",
      className: "bg-indigo-50 text-indigo-600",
    };
  }

  if (item.selectedContactCount > 0) {
    return {
      Icon: Users,
      label: "Specific contacts",
      className: "bg-sky-50 text-sky-600",
    };
  }

  return {
    Icon: Mail,
    label: "Project audience",
    className: "bg-sky-50 text-sky-600",
  };
}

function resolveProjectTone(item: CampaignRowViewModel) {
  const source =
    item.projectName ??
    item.projectLabel ??
    item.projectId ??
    item.runId;
  return TONE_CLASSES[projectToneFromName(source)];
}

function renderMetric(item: CampaignRowViewModel) {
  const totalAudience = resolveAudienceTotal(item);
  const sentCount = item.sentCount ?? 0;
  const openedCount = item.openedCount ?? 0;
  const openRatePercent =
    totalAudience === null || totalAudience <= 0
      ? 0
      : Math.round((openedCount / totalAudience) * 100);

  switch (item.state) {
    case "complete":
    case "finalized":
      return (
        <>
          <span>
            {formatCount(sentCount)} / {formatCount(totalAudience ?? sentCount)}{" "}
            sent
          </span>
          <span className="text-slate-400">·</span>
          <span className="inline-flex items-center gap-1">
            <Eye className={COMPLETE_OPEN_RATE_ICON_CLASS} aria-hidden="true" />
            {formatCount(openRatePercent)}%
          </span>
        </>
      );
    case "scheduled":
      return `${formatCount(totalAudience ?? 0)} queued`;
    case "sending":
      return `${formatCount(sentCount)} / ${formatCount(totalAudience ?? sentCount)} sent`;
    case "cancelled":
      return `${formatCount(sentCount)} / ${formatCount(totalAudience ?? sentCount)} before cancel`;
    case "draft":
      return totalAudience === null
        ? "Audience pending"
        : `~${formatCount(totalAudience)} recipients`;
  }
}

function renderDateLine(item: CampaignRowViewModel) {
  const label = (() => {
    switch (item.state) {
      case "sending":
        return "Started";
      case "scheduled":
        return "Scheduled";
      case "draft":
        return "Saved";
      case "complete":
      case "finalized":
      case "cancelled":
        return null;
    }
  })();

  const iso = (() => {
    switch (item.state) {
      case "sending":
        return item.startedAt ?? item.createdAt;
      case "scheduled":
        return item.scheduledAt ?? item.createdAt;
      case "draft":
        return item.updatedAt;
      case "complete":
      case "finalized":
        return item.completedAt ?? item.updatedAt;
      case "cancelled":
        return item.cancelledAt ?? item.updatedAt;
    }
  })();

  return label === null ? (
    <time dateTime={iso}>{DATE_TIME_FORMATTER.format(new Date(iso))}</time>
  ) : (
    <>
      <span>{label}</span>
      <span className="text-slate-400">·</span>
      <LocalDateTime iso={iso} />
    </>
  );
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
  readonly projectName: string | null;
  readonly projectAlias: string | null;
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
  readonly selectedContactCount: number;
  readonly sentCount: number | null;
  readonly openedCount: number | null;
}

export function CampaignRow({
  item,
  style,
}: {
  readonly item: CampaignRowViewModel;
  readonly style?: React.CSSProperties;
}) {
  const trimmedName = item.name?.trim() ?? "";
  const trimmedSubject = item.subject.trim();
  const hasName = trimmedName.length > 0;
  const untitledDraft = item.state === "draft" && !hasName;
  const title = hasName
    ? trimmedName
    : untitledDraft
      ? `Untitled — ${item.projectName ?? "broadcast"}`
      : trimmedSubject.length > 0
        ? trimmedSubject
        : "Untitled broadcast";
  const subjectLine =
    trimmedSubject.length > 0
      ? trimmedSubject
      : hasName
        ? trimmedName
        : "No subject yet";
  const href =
    item.provider === "mailchimp"
      ? `/campaigns/${encodeURIComponent(item.runId)}?provider=mailchimp`
      : `/campaigns/${encodeURIComponent(item.runId)}`;
  const typeMeta = readTypeMeta(item);
  const TypeIcon = typeMeta.Icon;
  const projectTone = resolveProjectTone(item);
  const accentClass = ACTIVE_ACCENT_CLASS[item.state] ?? "bg-transparent";
  const projectLabel = item.projectLabel?.trim() ?? "";
  const showProjectPill = projectLabel.length > 0;

  return (
    <div style={style}>
      <Link
        href={href}
        prefetch={false}
        data-campaign-row="true"
        data-campaign-provider={item.provider}
        data-campaign-state={item.state}
        className={cn(
          "group relative grid grid-cols-[44px_minmax(0,1fr)] gap-x-4 gap-y-3 overflow-hidden bg-white px-5 py-6 sm:grid-cols-[44px_minmax(0,1fr)_max-content] sm:items-start",
          TRANSITION.fast,
          TRANSITION.reduceMotion,
          "hover:bg-slate-50",
          FOCUS_RING,
        )}
      >
        <span
          aria-hidden="true"
          className={cn("absolute inset-y-0 left-0 w-[3px]", accentClass)}
        />
        <span
          className={cn(
            "mt-0.5 flex size-11 items-center justify-center",
            RADIUS.md,
            typeMeta.className,
          )}
          title={typeMeta.label}
        >
          <TypeIcon className="size-5" aria-hidden="true" />
        </span>

        <div className="min-w-0">
          <p
            className={cn(
              TYPE.headingMd,
              "truncate leading-6",
              untitledDraft && "italic text-slate-500",
            )}
          >
            {title}
          </p>

          <div className="mt-2 flex min-w-0 items-center gap-2">
            {showProjectPill ? (
              <span
                className={cn(
                  "shrink-0 px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                  RADIUS.sm,
                  projectTone.subtle,
                  projectTone.subtleText,
                  projectTone.ring,
                )}
              >
                {projectLabel}
              </span>
            ) : null}
            {showProjectPill ? (
              <span className="text-slate-400" aria-hidden="true">
                ·
              </span>
            ) : null}
            <p
              className={cn(
                "min-w-0 truncate text-sm",
                trimmedSubject.length > 0
                  ? "text-slate-600"
                  : "italic text-slate-500",
              )}
            >
              {subjectLine}
            </p>
          </div>
        </div>

        <div className="col-start-2 flex min-w-0 flex-col items-start gap-1 text-left sm:col-start-3 sm:items-end sm:text-right">
          <RunStateChip state={item.state} variant="list" />
          <p className="flex items-center gap-1.5 text-xs text-slate-600">
            {renderMetric(item)}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            {renderDateLine(item)}
          </p>
        </div>
      </Link>
    </div>
  );
}
