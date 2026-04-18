"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import {
  clearInboxNeedsFollowUpAction,
  markInboxNeedsFollowUpAction
} from "../actions";
import { fetchInboxTimelinePage } from "../_lib/client-api";
import type { InboxDetailViewModel } from "../_lib/view-models";
import { InboxFreshnessPoller } from "./inbox-freshness-poller";
import {
  useInboxClient,
  type Reminder
} from "./inbox-client-provider";
import { SectionLabel } from "@/components/ui/section-label";
import { LAYOUT, TEXT, TONE, TRANSITION, SPACING } from "@/app/_lib/design-tokens";
import { InboxComposer } from "./inbox-composer";
import {
  InboxContactRail,
  InboxProjectStatusBadge
} from "./inbox-contact-rail";
import { TimelineSkeleton } from "./inbox-loading";
import { InboxTimeline } from "./inbox-timeline";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  CornerUpLeftIcon,
  PanelRightOpenIcon,
  XIcon
} from "./icons";

interface DetailProps {
  readonly detail: InboxDetailViewModel;
}

type ReminderUnit = "hours" | "days" | "weeks";

export function InboxDetail({ detail }: DetailProps) {
  const { contact, smsEligible } = detail;
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const activeTimelineRequestIdRef = useRef(0);
  const {
    reminders,
    setReminder,
    clearReminder,
    isTimelineLoading,
    setTimelineLoading
  } = useInboxClient();

  const [railOpen, setRailOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderValue, setReminderValue] = useState("");
  const [reminderUnit, setReminderUnit] = useState<ReminderUnit>("hours");
  const [timelineEntries, setTimelineEntries] = useState(detail.timeline);
  const [timelinePage, setTimelinePage] = useState(detail.timelinePage);

  useEffect(() => {
    activeTimelineRequestIdRef.current += 1;
    setTimelineLoading(false);
    setTimelineEntries(detail.timeline);
    setTimelinePage(detail.timelinePage);
  }, [
    detail.contact.contactId,
    detail.freshness.inboxUpdatedAt,
    detail.freshness.timelineCount,
    detail.freshness.timelineUpdatedAt,
    detail.timeline,
    detail.timelinePage,
    setTimelineLoading
  ]);

  const loadOlderTimeline = useCallback(async () => {
    if (!timelinePage.hasMore || timelinePage.nextCursor === null) {
      return;
    }

    const requestId = activeTimelineRequestIdRef.current + 1;
    activeTimelineRequestIdRef.current = requestId;
    const container = timelineScrollRef.current;
    const previousScrollHeight = container?.scrollHeight ?? 0;
    const previousScrollTop = container?.scrollTop ?? 0;
    setTimelineLoading(true);

    try {
      const nextPage = await fetchInboxTimelinePage({
        contactId: contact.contactId,
        cursor: timelinePage.nextCursor
      });

      if (activeTimelineRequestIdRef.current !== requestId) {
        return;
      }

      setTimelineEntries((previousEntries) => [
        ...nextPage.entries,
        ...previousEntries
      ]);
      setTimelinePage(nextPage.page);

      window.requestAnimationFrame(() => {
        const nextContainer = timelineScrollRef.current;

        if (!nextContainer) {
          return;
        }

        const nextScrollHeight = nextContainer.scrollHeight;
        nextContainer.scrollTop =
          previousScrollTop + (nextScrollHeight - previousScrollHeight);
      });
    } catch {
      // Keep the current timeline page visible; polling or the next click can retry.
    } finally {
      if (activeTimelineRequestIdRef.current === requestId) {
        setTimelineLoading(false);
      }
    }
  }, [contact.contactId, setTimelineLoading, timelinePage]);

  const activeProject = contact.activeProjects[0] ?? null;
  const firstName = contact.displayName.split(" ")[0] ?? contact.displayName;
  const isFollowUp = detail.needsFollowUp;
  const existingReminder = reminders.get(contact.contactId) ?? null;

  const handleSetReminder = () => {
    const numeric = Number(reminderValue);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    setReminder(contact.contactId, buildReminder(numeric, reminderUnit));
    setReminderValue("");
    setReminderOpen(false);
  };

  const handleClearReminder = () => {
    clearReminder(contact.contactId);
    setReminderOpen(false);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <InboxFreshnessPoller
        contactId={contact.contactId}
        detailFreshness={detail.freshness}
      />

      <section className="flex min-w-0 flex-1 flex-col border-r border-slate-200 bg-white">
        <header className={`flex ${LAYOUT.headerHeight} items-center justify-between gap-4 border-b border-slate-200 px-6`}>
          <div className="flex min-w-0 items-center gap-4">
            <h1 className={`truncate ${TEXT.headingLg}`}>
              {contact.displayName}
            </h1>
            <div className="hidden h-5 w-px bg-slate-200 sm:block" />
            <div className="hidden min-w-0 flex-1 sm:block">
              {activeProject ? (
                <div className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="min-w-0 truncate font-medium text-slate-700">
                    {activeProject.projectName}{" "}
                    {activeProject.year.toString()}
                  </span>
                  <InboxProjectStatusBadge status={activeProject.status} />
                </div>
              ) : (
                <span className="text-xs text-slate-400">
                  No active project
                </span>
              )}
            </div>
            <div className="hidden items-center gap-1.5 sm:flex">
              {detail.bucket === "new" ? (
                <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800">
                  Unread
                </span>
              ) : null}
              {isFollowUp ? (
                <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-800">
                  Needs Follow-Up
                </span>
              ) : null}
              {contact.hasUnresolved ? (
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  Unresolved
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <FollowUpToggleForm
              contactId={contact.contactId}
              needsFollowUp={isFollowUp}
            />

            <Popover open={reminderOpen} onOpenChange={setReminderOpen}>
              <PopoverTrigger asChild>
                {existingReminder ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 hover:text-sky-800"
                  >
                    <ClockIcon className="h-3.5 w-3.5" />
                    Reminder · {formatShortReminder(existingReminder)}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Set a reminder"
                  >
                    <ClockIcon className="h-4 w-4" />
                  </Button>
                )}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <ReminderPopoverBody
                  existing={existingReminder}
                  value={reminderValue}
                  unit={reminderUnit}
                  onChangeValue={setReminderValue}
                  onChangeUnit={setReminderUnit}
                  onClose={() => {
                    setReminderOpen(false);
                  }}
                  onSet={handleSetReminder}
                  onClear={handleClearReminder}
                />
              </PopoverContent>
            </Popover>

            {!railOpen ? (
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="Expand volunteer details"
                aria-expanded={false}
                aria-controls="inbox-contact-rail"
                onClick={() => {
                  setRailOpen(true);
                }}
              >
                <PanelRightOpenIcon className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </header>

        {contact.hasUnresolved ? <UnresolvedBanner /> : null}

        <div
          ref={timelineScrollRef}
          className={`min-h-0 flex-1 overflow-y-auto ${TONE.slate.subtle} ${SPACING.container}`}
        >
          {isTimelineLoading && timelineEntries.length === 0 ? (
            <TimelineSkeleton />
          ) : (
            <InboxTimeline
              entries={timelineEntries}
              volunteerFirstName={firstName}
              hasMore={timelinePage.hasMore}
              isLoadingOlder={isTimelineLoading}
              onLoadOlder={() => {
                void loadOlderTimeline();
              }}
            />
          )}
        </div>

        <div className="shrink-0">
          <InboxComposer
            contactDisplayName={contact.displayName}
            smsEligible={smsEligible}
            onOpenChange={(open) => {
              if (open && timelineScrollRef.current) {
                setTimeout(() => {
                  const element = timelineScrollRef.current;

                  if (element) {
                    element.scrollTop = element.scrollHeight;
                  }
                }, 50);
              }
            }}
          />
        </div>
      </section>

      <div
        className={cn(
          `overflow-hidden border-l ${TRANSITION.layout} ${TRANSITION.reduceMotion}`,
          railOpen
            ? `${LAYOUT.railWidth} border-slate-200 opacity-100`
            : "w-0 border-transparent opacity-0"
        )}
      >
        <div className={LAYOUT.railWidth}>
          <InboxContactRail
            contact={contact}
            onClose={() => {
              setRailOpen(false);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function FollowUpToggleForm({
  contactId,
  needsFollowUp
}: {
  readonly contactId: string;
  readonly needsFollowUp: boolean;
}) {
  const action = async (formData: FormData) => {
    if (needsFollowUp) {
      await clearInboxNeedsFollowUpAction(formData);
      return;
    }

    await markInboxNeedsFollowUpAction(formData);
  };

  return (
    <form action={action}>
      <input type="hidden" name="contactId" value={contactId} />
      <FollowUpToggleButton needsFollowUp={needsFollowUp} />
    </form>
  );
}

function FollowUpToggleButton({
  needsFollowUp
}: {
  readonly needsFollowUp: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-pressed={needsFollowUp}
      className={cn(
        "gap-1.5",
        needsFollowUp &&
          "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 hover:text-rose-800"
      )}
    >
      <CornerUpLeftIcon className="h-3.5 w-3.5" />
      Needs Follow-Up
    </Button>
  );
}

function UnresolvedBanner() {
  return (
    <div
      className={`flex items-center gap-2 border-b border-amber-200 px-6 py-2.5 ${TONE.amber.subtle}`}
      role="status"
    >
      <AlertTriangleIcon className="h-4 w-4 shrink-0 text-amber-600" />
      <span className="text-sm font-medium text-amber-900">
        Unresolved items need attention
      </span>
    </div>
  );
}

interface ReminderPopoverBodyProps {
  readonly existing: Reminder | null;
  readonly value: string;
  readonly unit: ReminderUnit;
  readonly onChangeValue: (value: string) => void;
  readonly onChangeUnit: (unit: ReminderUnit) => void;
  readonly onClose: () => void;
  readonly onSet: () => void;
  readonly onClear: () => void;
}

const REMINDER_UNITS: readonly ReminderUnit[] = ["hours", "days", "weeks"];

function ReminderPopoverBody({
  existing,
  value,
  unit,
  onChangeValue,
  onChangeUnit,
  onClose,
  onSet,
  onClear
}: ReminderPopoverBodyProps) {
  const numeric = Number(value);
  const canSet = value.length > 0 && Number.isFinite(numeric) && numeric > 0;
  const preview = canSet ? previewForDelta(numeric, unit) : null;

  if (existing) {
    return (
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <SectionLabel as="p">
            Reminder set
          </SectionLabel>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {formatLongReminder(existing)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            In {formatShortReminder(existing)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-slate-400 hover:text-slate-700"
          aria-label="Cancel reminder"
          onClick={onClear}
        >
          <XIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <SectionLabel as="p">
        Remind me in
      </SectionLabel>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex h-9 w-16 items-center overflow-hidden rounded-md border border-slate-200 shadow-sm">
          <span
            className="flex-1 select-none text-center text-sm font-semibold tabular-nums text-slate-900"
            aria-live="polite"
          >
            {value || "0"}
          </span>
          <div className="flex flex-col border-l border-slate-200">
            <button
              type="button"
              aria-label="Increase"
              onClick={() => {
                const nextValue = Math.min(99, (Number(value) || 0) + 1);
                onChangeValue(nextValue.toString());
              }}
              className="flex h-[18px] w-6 items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <ChevronUpIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Decrease"
              onClick={() => {
                const nextValue = Math.max(0, (Number(value) || 0) - 1);
                onChangeValue(nextValue.toString());
              }}
              className="flex h-[18px] w-6 items-center justify-center border-t border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <ChevronDownIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex flex-1 items-center gap-1 rounded-lg bg-slate-100 p-0.5 text-[11px] font-medium">
          {REMINDER_UNITS.map((option) => {
            const isActive = option === unit;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  onChangeUnit(option);
                }}
                className={cn(
                  "flex-1 rounded-md px-1.5 py-1 capitalize transition-colors duration-150",
                  isActive
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-900"
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>
      <p
        className={cn(
          "mt-2 min-h-4 text-[11px]",
          preview ? "text-slate-500" : "text-transparent"
        )}
        aria-live="polite"
      >
        {preview ?? "—"}
      </p>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canSet} onClick={onSet}>
          Set reminder
        </Button>
      </div>
    </>
  );
}

function buildReminder(value: number, unit: ReminderUnit): Reminder {
  const ms = value * millisPerUnit(unit);
  const firesAt = new Date(Date.now() + ms).toISOString();
  return { value, unit, firesAt };
}

function millisPerUnit(unit: ReminderUnit): number {
  switch (unit) {
    case "hours":
      return 60 * 60 * 1000;
    case "days":
      return 24 * 60 * 60 * 1000;
    case "weeks":
      return 7 * 24 * 60 * 60 * 1000;
  }
}

function previewForDelta(value: number, unit: ReminderUnit): string {
  const ms = value * millisPerUnit(unit);
  const target = new Date(Date.now() + ms);
  return formatAbsolute(target);
}

function formatShortReminder(reminder: Reminder): string {
  const unitLabel =
    reminder.value === 1 ? reminder.unit.slice(0, -1) : reminder.unit;
  return `${reminder.value.toString()} ${unitLabel}`;
}

function formatLongReminder(reminder: Reminder): string {
  return formatAbsolute(new Date(reminder.firesAt));
}

function formatAbsolute(target: Date): string {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const startOfTarget = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  ).getTime();
  const dayDelta = Math.round(
    (startOfTarget - startOfToday) / (24 * 60 * 60 * 1000)
  );

  const time = formatTime(target);

  if (dayDelta === 0) return `Today at ${time}`;
  if (dayDelta === 1) return `Tomorrow at ${time}`;
  if (dayDelta > 1 && dayDelta < 7) {
    return `${weekdayName(target.getDay())} at ${time}`;
  }
  return `${monthName(target.getMonth())} ${target.getDate().toString()} at ${time}`;
}

function formatTime(target: Date): string {
  const hours24 = target.getHours();
  const minutes = target.getMinutes();
  const ampm = hours24 >= 12 ? "pm" : "am";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  if (minutes === 0) return `${hours12.toString()} ${ampm}`;
  const padded = minutes < 10 ? `0${minutes.toString()}` : minutes.toString();
  return `${hours12.toString()}:${padded} ${ampm}`;
}

function weekdayName(day: number): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    day
  ] ?? "Unknown";
}

function monthName(month: number): string {
  return [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ][month] ?? "Unknown";
}
