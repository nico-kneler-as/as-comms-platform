import Link from "next/link";
import { Eye, Mail, Megaphone, MessageSquare, Users } from "lucide-react";

import type { CampaignRunProjectionRow } from "@as-comms/contracts";

import { TONE_CLASSES, FOCUS_RING, TRANSITION } from "@/app/_lib/design-tokens-v2";
import { ORG_TIMEZONE } from "@/app/_lib/org-timezone";
import { projectToneFromName } from "@/app/inbox/_lib/project-tone";
import { cn } from "@/lib/utils";

import { LocalDateTime } from "../[runId]/_components/local-date-time";
import { RunStateChip } from "../[runId]/_components/run-state-chip";

const ACTIVE_ACCENT_CLASS: Partial<Record<CampaignRunProjectionRow["state"], string>> =
  {
    sending: "bg-sky-500",
    scheduled: "bg-indigo-400",
  };

const COMPLETE_OPEN_RATE_ICON_CLASS = "size-2.5 text-slate-500";

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
        className: "bg-violet-50 text-violet-600 ring-violet-100",
      };
    }

  if (item.launchType === "sms") {
    if (item.selectedContactCount > 0) {
      return {
        Icon: Users,
        label: "SMS to specific contacts",
        className: "bg-indigo-50 text-indigo-600 ring-indigo-100",
      };
    }
    return {
      Icon: MessageSquare,
      label: "Project SMS",
      className: "bg-indigo-50 text-indigo-600 ring-indigo-100",
    };
  }

  if (item.selectedContactCount > 0) {
    return {
      Icon: Users,
      label: "Specific contacts",
      className: "bg-sky-50 text-sky-600 ring-sky-100",
    };
  }

  return {
    Icon: Mail,
    label: "Project audience",
    className: "bg-sky-50 text-sky-600 ring-sky-100",
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
      ? `/broadcasts/${encodeURIComponent(item.runId)}?provider=mailchimp`
      : `/broadcasts/${encodeURIComponent(item.runId)}`;
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
          "group relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 overflow-hidden bg-white px-5 py-3",
          TRANSITION.fast,
          TRANSITION.reduceMotion,
          "hover:bg-slate-50",
          FOCUS_RING,
        )}
      >
        <span
          aria-hidden="true"
          className={cn("absolute inset-y-0 left-0 w-0.5", accentClass)}
        />
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-md ring-1 ring-inset",
            typeMeta.className,
          )}
          title={typeMeta.label}
        >
          <TypeIcon className="size-4" aria-hidden="true" />
        </span>

        <div className="min-w-0">
          <p
            className={cn(
              "truncate text-[13.5px] font-semibold text-slate-900",
              untitledDraft && "italic text-slate-500",
            )}
          >
            {title}
          </p>

          <div className="mt-1 flex min-w-0 items-center gap-2">
            {showProjectPill ? (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-px text-[10px] font-semibold tracking-tight",
                  projectTone.subtle,
                  projectTone.subtleText,
                )}
              >
                {projectLabel}
              </span>
            ) : null}
            <p
              className={cn(
                "min-w-0 truncate text-[12px]",
                trimmedSubject.length > 0
                  ? "text-slate-600"
                  : "italic text-slate-500",
              )}
            >
              {subjectLine}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 whitespace-nowrap text-right">
          <RunStateChip state={item.state} variant="list" />
          <p className="flex items-center gap-1.5 text-[11px] tabular-nums text-slate-500">
            {renderMetric(item)}
          </p>
          <p className="flex items-center gap-1.5 text-[10.5px] text-slate-500">
            {renderDateLine(item)}
          </p>
        </div>
      </Link>
    </div>
  );
}
