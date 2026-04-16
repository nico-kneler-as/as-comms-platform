"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { ClaudeInboxDetailViewModel } from "../_lib/view-models";
import {
  useClaudeInboxClient,
  type Reminder
} from "./claude-inbox-client-provider";
import { ClaudeInboxComposer } from "./claude-inbox-composer";
import {
  ClaudeInboxContactRail,
  ProjectStatusBadge
} from "./claude-inbox-contact-rail";
import { TimelineSkeleton } from "./claude-inbox-loading";
import { ClaudeInboxTimeline } from "./claude-inbox-timeline";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  CornerUpLeftIcon,
  PanelRightOpenIcon,
  XIcon
} from "./claude-icons";

interface DetailProps {
  readonly detail: ClaudeInboxDetailViewModel;
}

type ReminderUnit = "hours" | "days" | "weeks";

export function ClaudeInboxDetail({ detail }: DetailProps) {
  const { contact, timeline, smsEligible } = detail;
  const timelineRef = useRef<HTMLDivElement>(null);
  const {
    followUp,
    toggleFollowUp,
    reminders,
    setReminder,
    clearReminder,
    isTimelineLoading
  } = useClaudeInboxClient();

  const [railOpen, setRailOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderValue, setReminderValue] = useState("");
  const [reminderUnit, setReminderUnit] = useState<ReminderUnit>("hours");

  const activeProject = contact.activeProjects[0] ?? null;
  const firstName = contact.displayName.split(" ")[0] ?? contact.displayName;

  const isFollowUp = followUp.has(contact.contactId);
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
      <section className="flex min-w-0 flex-1 flex-col border-r border-slate-200 bg-white">
        {/* Detail header */}
        <header className="flex h-[65px] items-center justify-between gap-4 border-b border-slate-200 px-6">
          <div className="flex min-w-0 items-center gap-4">
            <h1 className="truncate text-lg font-semibold text-slate-900">
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
                  <ProjectStatusBadge status={activeProject.status} />
                </div>
              ) : (
                <span className="text-xs text-slate-400">
                  No active project
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Needs Follow Up toggle — off / on */}
            <Button
              variant="outline"
              size="sm"
              aria-pressed={isFollowUp}
              onClick={() => {
                toggleFollowUp(contact.contactId);
              }}
              className={cn(
                "gap-1.5",
                isFollowUp &&
                  "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 hover:text-rose-800"
              )}
            >
              <CornerUpLeftIcon className="h-3.5 w-3.5" />
              Needs Follow Up
            </Button>

            {/* Reminder popover */}
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
                aria-controls="claude-inbox-contact-rail"
                onClick={() => {
                  setRailOpen(true);
                }}
              >
                <PanelRightOpenIcon className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </header>

        {/* Unresolved banner */}
        {contact.hasUnresolved ? <UnresolvedBanner /> : null}

        {/* Timeline area */}
        <div
          ref={timelineRef}
          className="min-h-0 flex-1 overflow-y-auto bg-slate-50/40 px-6 py-6"
        >
          {isTimelineLoading ? (
            <TimelineSkeleton />
          ) : (
            <ClaudeInboxTimeline
              entries={timeline}
              volunteerFirstName={firstName}
            />
          )}
        </div>

        <div className="shrink-0">
          <ClaudeInboxComposer
            contactDisplayName={contact.displayName}
            smsEligible={smsEligible}
            onOpenChange={(open) => {
              if (open && timelineRef.current) {
                // Scroll timeline to bottom when composer opens
                // so the latest messages stay visible
                setTimeout(() => {
                  const el = timelineRef.current as unknown as
                    | { scrollTop: number; scrollHeight: number }
                    | null;
                  if (el) el.scrollTop = el.scrollHeight;
                }, 50);
              }
            }}
          />
        </div>
      </section>

      {/* Animated contact rail — width transitions from 0 → 20rem */}
      <div
        className={cn(
          "overflow-hidden border-l transition-all duration-200 ease-out motion-reduce:transition-none",
          railOpen
            ? "w-80 border-slate-200 opacity-100"
            : "w-0 border-transparent opacity-0"
        )}
      >
        <div className="w-80">
          <ClaudeInboxContactRail
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

// ---------- Unresolved banner ----------

function UnresolvedBanner() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-amber-200 bg-amber-50/80">
      <button
        type="button"
        onClick={() => {
          setExpanded((e) => !e);
        }}
        className="flex w-full items-center gap-2 px-6 py-2.5 text-left transition-colors hover:bg-amber-100/60"
        aria-expanded={expanded}
      >
        <AlertTriangleIcon className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="flex-1 text-sm font-medium text-amber-900">
          Unresolved items need attention
        </span>
        <span className="text-xs text-amber-600">
          {expanded ? "Hide" : "Details"}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-amber-200 px-6 py-3">
          <p className="text-xs leading-5 text-amber-800">
            This contact has open items that require action before the
            conversation can be considered resolved. Review the timeline
            for pending requests and routing notices.
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ---------- Reminder popover body ----------

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
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Reminder set
          </p>
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
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Remind me in
      </p>
      <div className="mt-2 flex items-center gap-2">
        {/* Number stepper */}
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
                const n = Math.min(99, (Number(value) || 0) + 1);
                onChangeValue(n.toString());
              }}
              className="flex h-[18px] w-6 items-center justify-center text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <ChevronUpIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Decrease"
              onClick={() => {
                const n = Math.max(0, (Number(value) || 0) - 1);
                onChangeValue(n.toString());
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

// ---------- Reminder helpers ----------

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
  return [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
  ][day] ?? "";
}

function monthName(month: number): string {
  return [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ][month] ?? "";
}
