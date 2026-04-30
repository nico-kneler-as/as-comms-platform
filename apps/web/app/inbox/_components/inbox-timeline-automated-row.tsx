"use client";

import type { ComponentType } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TRANSITION } from "@/app/_lib/design-tokens-v2";

import type {
  InboxTimelineEntryKind,
  InboxTimelineEntryViewModel,
} from "../_lib/view-models";
import { autolinkText } from "./_autolink";
import {
  CheckCircleIcon,
  ChevronRightIcon,
  EyeIcon,
  MailIcon,
  MegaphoneIcon,
  MousePointerClickIcon,
  PhoneIcon,
  WandIcon,
  XIcon,
  ZapIcon,
} from "./icons";

const WRAP_ANYWHERE = "break-words [overflow-wrap:anywhere]";
const EXACT_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

function formatExactTimestamp(timestamp: string): string {
  return EXACT_TIMESTAMP_FORMATTER.format(new Date(timestamp));
}

function RelativeTimestamp({
  timestamp,
  label,
  className,
}: {
  readonly timestamp: string;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <time
      dateTime={timestamp}
      title={formatExactTimestamp(timestamp)}
      className={className}
    >
      {label}
    </time>
  );
}

function bodyTextForEntry(entry: InboxTimelineEntryViewModel): string {
  return entry.body.trim();
}

interface EventRowDescriptor {
  readonly label: string;
  readonly Icon: ComponentType<{ className?: string }>;
  readonly shellClassName: string;
  readonly hoverClassName: string;
  readonly iconClassName: string;
  readonly labelClassName: string;
}

function describeEventRow(input: {
  readonly role: "automated" | "campaign" | "activity";
  readonly isEmail: boolean;
}): EventRowDescriptor {
  if (input.role === "campaign") {
    return {
      label: input.isEmail ? "Campaign" : "Campaign SMS",
      Icon: MegaphoneIcon,
      shellClassName: "border-violet-200/70 bg-violet-50/30",
      hoverClassName: "hover:bg-violet-50/60",
      iconClassName: "bg-violet-100 text-violet-700",
      labelClassName: "text-violet-700",
    };
  }

  if (input.role === "activity") {
    return {
      label: input.isEmail ? "Activity" : "SMS Activity",
      Icon: input.isEmail ? MailIcon : PhoneIcon,
      shellClassName: "border-violet-200 bg-violet-50/75",
      hoverClassName: "hover:bg-violet-50",
      iconClassName: "bg-violet-100 text-violet-700",
      labelClassName: "text-violet-700",
    };
  }

  return {
    label: input.isEmail ? "Automated" : "Automated SMS",
    Icon: input.isEmail ? ZapIcon : WandIcon,
    shellClassName: "border-slate-200 bg-slate-50/40",
    hoverClassName: "hover:bg-slate-100/60",
    iconClassName: "bg-slate-100 text-slate-600",
    labelClassName: "text-slate-500",
  };
}

function describeCampaignVisualState(
  activities: readonly {
    readonly activityType: "sent" | "opened" | "clicked" | "unsubscribed";
  }[],
): "sent" | "opened" | "clicked" | "unsubscribed" {
  if (activities.some((activity) => activity.activityType === "unsubscribed")) {
    return "unsubscribed";
  }

  if (activities.some((activity) => activity.activityType === "clicked")) {
    return "clicked";
  }

  if (activities.some((activity) => activity.activityType === "opened")) {
    return "opened";
  }

  return "sent";
}

function CampaignStateIcon({
  state,
}: {
  readonly state: ReturnType<typeof describeCampaignVisualState>;
}) {
  const AccentIcon =
    state === "clicked"
      ? MousePointerClickIcon
      : state === "opened"
        ? EyeIcon
        : state === "unsubscribed"
          ? XIcon
          : null;

  return (
    <span className="relative inline-flex">
      <MegaphoneIcon className="size-4" />
      {AccentIcon ? (
        <span className="absolute -right-1 -top-1 inline-flex size-3.5 items-center justify-center rounded-full border border-violet-200 bg-white text-violet-700 shadow-sm">
          <AccentIcon className="size-2" />
        </span>
      ) : (
        <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-violet-500 ring-2 ring-white" />
      )}
    </span>
  );
}

function CampaignStateBadge({
  state,
}: {
  readonly state: ReturnType<typeof describeCampaignVisualState>;
}) {
  const label =
    state === "clicked"
      ? "Clicked"
      : state === "opened"
        ? "Opened"
        : state === "unsubscribed"
          ? "Unsubscribed"
          : "Sent";
  const Icon =
    state === "clicked"
      ? MousePointerClickIcon
      : state === "opened"
        ? EyeIcon
        : state === "unsubscribed"
          ? XIcon
          : CheckCircleIcon;
  const className =
    state === "clicked"
      ? "bg-emerald-50 text-emerald-700"
      : state === "opened"
        ? "bg-indigo-50 text-indigo-700"
        : state === "unsubscribed"
          ? "bg-rose-50 text-rose-700"
          : "bg-slate-50 text-slate-700";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        className,
      )}
    >
      <Icon className="size-2.5" />
      {label}
    </span>
  );
}

export function shouldHideAutomatedRowBody(input: {
  readonly isExpanded: boolean;
  readonly kind: InboxTimelineEntryKind;
  readonly headline: string | null;
}): boolean {
  return (
    !input.isExpanded &&
    ((input.kind === "outbound-auto-email" && input.headline !== null) ||
      input.kind === "outbound-campaign-email")
  );
}

export function TimelineAutomatedRow({
  entry,
  role,
  isExpanded,
  onToggle,
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly role: "automated" | "campaign" | "activity";
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}) {
  const isEmail = entry.channel === "email";
  const campaignActivity =
    entry.kind === "outbound-campaign-email" ? entry.campaignActivity : [];
  const campaignState =
    role === "campaign"
      ? describeCampaignVisualState(campaignActivity)
      : undefined;
  const descriptor = describeEventRow({
    role,
    isEmail,
  });
  const headline = entry.subject;
  const body = bodyTextForEntry(entry);
  const hideCollapsedBody = shouldHideAutomatedRowBody({
    isExpanded,
    kind: entry.kind,
    headline,
  });

  return (
    <li className="flex w-full flex-col items-end pl-16">
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "w-full max-w-[560px] overflow-hidden rounded-xl border",
              descriptor.shellClassName,
            )}
          >
            <button
              type="button"
              aria-expanded={isExpanded}
              title={formatExactTimestamp(entry.occurredAt)}
              onClick={onToggle}
              data-event-role={role}
              data-campaign-state={campaignState}
              className={cn(
                "group flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left",
                "transition-[background-color,transform] duration-150 ease-out active:scale-[0.99]",
                descriptor.hoverClassName,
                TRANSITION.reduceMotion,
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <div
                  className={cn(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-md",
                    descriptor.iconClassName,
                  )}
                >
                  {role === "campaign" ? (
                    <CampaignStateIcon state={campaignState ?? "sent"} />
                  ) : (
                    <descriptor.Icon className="size-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "text-[9.5px] font-semibold uppercase tracking-wider",
                        descriptor.labelClassName,
                      )}
                    >
                      {descriptor.label}
                    </span>
                    <span
                      aria-hidden="true"
                      className="text-[11px] text-slate-400 tabular-nums"
                    >
                      ·
                    </span>
                    <RelativeTimestamp
                      timestamp={entry.occurredAt}
                      label={entry.occurredAtLabel}
                      className="text-[11px] text-slate-400 tabular-nums"
                    />
                  </div>
                  {headline ? (
                    <p
                      className={cn(
                        "mt-0.5 truncate text-[12.5px] font-medium text-slate-800",
                        WRAP_ANYWHERE,
                      )}
                    >
                      {headline}
                    </p>
                  ) : null}
                  {!hideCollapsedBody && body.length > 0 ? (
                    <p
                      className={cn(
                        "mt-0.5 line-clamp-1 font-message-body text-[13.5px] leading-relaxed text-slate-700",
                        WRAP_ANYWHERE,
                      )}
                    >
                      {body}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {role === "campaign" && campaignState !== undefined ? (
                  <CampaignStateBadge state={campaignState} />
                ) : null}
                <ChevronRightIcon
                  className={cn(
                    "h-3.5 w-3.5 text-slate-500 transition-transform duration-150",
                    isExpanded && "rotate-90",
                  )}
                />
              </div>
            </button>
            {isExpanded && body.length > 0 ? (
              <div className="border-t border-slate-200 bg-white px-4 py-3">
                <p
                  className={cn(
                    "whitespace-pre-wrap text-pretty font-message-body text-[13.5px] leading-relaxed text-slate-700",
                    WRAP_ANYWHERE,
                  )}
                >
                  {autolinkText(body, "text-sky-600")}
                </p>
              </div>
            ) : null}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{formatExactTimestamp(entry.occurredAt)}</p>
        </TooltipContent>
      </Tooltip>
    </li>
  );
}
