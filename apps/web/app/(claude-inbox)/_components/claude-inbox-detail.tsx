"use client";

import { useEffect, useState } from "react";

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
import { ClaudeInboxTimeline } from "./claude-inbox-timeline";
import {
  ClockIcon,
  CornerUpLeftIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  XIcon
} from "./claude-icons";

interface DetailProps {
  readonly detail: ClaudeInboxDetailViewModel;
}

type ReminderUnit = "hours" | "days" | "weeks";

/**
 * Client island: owns the right-rail disclosure state (`railOpen`) and the
 * inline "Set a Reminder" popover state. Follow-up and reminder state live
 * in {@link useClaudeInboxClient} so the list column can react immediately
 * — the local state here is only the transient popover UI.
 */
export function ClaudeInboxDetail({ detail }: DetailProps) {
  const { contact, timeline, smsEligible } = detail;
  const { followUp, toggleFollowUp, reminders, setReminder, clearReminder } =
    useClaudeInboxClient();

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
                    {activeProject.projectName} {activeProject.year.toString()}
                  </span>
                  <ProjectStatusBadge status={activeProject.status} />
                </div>
              ) : (
                <span className="text-xs text-slate-400">No active project</span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-pressed={isFollowUp}
              onClick={() => {
                toggleFollowUp(contact.contactId);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 motion-reduce:transition-none ${
                isFollowUp
                  ? "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <CornerUpLeftIcon className="h-3.5 w-3.5" />
              Needs Follow Up
            </button>

            <div className="relative">
              {existingReminder ? (
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={reminderOpen}
                  onClick={() => {
                    setReminderOpen((open) => !open);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-800 shadow-sm transition-colors duration-150 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 motion-reduce:transition-none"
                >
                  <ClockIcon className="h-3.5 w-3.5" />
                  Reminder · {formatShortReminder(existingReminder)}
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Set a reminder"
                  aria-haspopup="dialog"
                  aria-expanded={reminderOpen}
                  onClick={() => {
                    setReminderOpen((open) => !open);
                  }}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 motion-reduce:transition-none ${
                    reminderOpen
                      ? "border-slate-300 bg-slate-100 text-slate-900"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <ClockIcon className="h-4 w-4" />
                </button>
              )}
              {reminderOpen ? (
                <ReminderPopover
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
              ) : null}
            </div>

            <button
              type="button"
              aria-label={
                railOpen
                  ? "Collapse volunteer details"
                  : "Expand volunteer details"
              }
              aria-expanded={railOpen}
              aria-controls="claude-inbox-contact-rail"
              onClick={() => {
                setRailOpen((open) => !open);
              }}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 motion-reduce:transition-none ${
                railOpen
                  ? "border-slate-300 bg-slate-100 text-slate-900 hover:bg-slate-200"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {railOpen ? (
                <PanelRightCloseIcon className="h-4 w-4" />
              ) : (
                <PanelRightOpenIcon className="h-4 w-4" />
              )}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-50/40 px-6 py-6">
          <ClaudeInboxTimeline
            entries={timeline}
            volunteerFirstName={firstName}
          />
        </div>

        <ClaudeInboxComposer
          contactDisplayName={contact.displayName}
          smsEligible={smsEligible}
        />
      </section>

      {railOpen ? <ClaudeInboxContactRail contact={contact} /> : null}
    </div>
  );
}

interface ReminderPopoverProps {
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

function ReminderPopover({
  existing,
  value,
  unit,
  onChangeValue,
  onChangeUnit,
  onClose,
  onSet,
  onClear
}: ReminderPopoverProps) {
  const numeric = Number(value);
  const canSet = value.length > 0 && Number.isFinite(numeric) && numeric > 0;
  const preview = canSet ? previewForDelta(numeric, unit) : null;

  // Keyboard dismissal: bind an Escape listener while the popover is mounted
  // so keyboard users have parity with the click-outside backdrop. The
  // project tsconfig omits the DOM lib, so we narrow `globalThis` through
  // unknown to reach `addEventListener` the same way the composer narrows
  // input events.
  useEffect(() => {
    type KeyListener = (event: { readonly key: string }) => void;
    const target = globalThis as unknown as {
      readonly addEventListener: (
        type: "keydown",
        listener: KeyListener
      ) => void;
      readonly removeEventListener: (
        type: "keydown",
        listener: KeyListener
      ) => void;
    };
    const handleKeyDown: KeyListener = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    target.addEventListener("keydown", handleKeyDown);
    return () => {
      target.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <>
      {/*
        Invisible full-screen backdrop so clicks outside dismiss the popover.
        Using a <button> keeps the dismiss semantics accessible without
        pulling in DOM event listener types.
      */}
      <button
        type="button"
        aria-label="Dismiss reminder"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-20 cursor-default bg-transparent"
      />
      <div
        role="dialog"
        aria-label="Set a reminder"
        className="absolute right-0 top-full z-30 mt-2 w-72 origin-top-right overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-lg ring-1 ring-black/5 transition duration-150 ease-out"
      >
        {existing ? (
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
            <button
              type="button"
              aria-label="Cancel reminder"
              onClick={onClear}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Remind me in
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={2}
                value={value}
                onChange={(event) => {
                  // tsconfig omits the DOM lib so we narrow through unknown
                  // to reach `.value`. We also strip non-digits defensively.
                  const target = event.currentTarget as unknown as {
                    readonly value: string;
                  };
                  const digits = target.value.replace(/\D/g, "").slice(0, 2);
                  onChangeValue(digits);
                }}
                placeholder="0"
                className="w-14 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-sm font-medium text-slate-900 tabular-nums placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
              />
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
                      className={`flex-1 rounded-md px-1.5 py-1 capitalize transition-colors duration-150 ${
                        isActive
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </div>
            <p
              className={`mt-2 min-h-4 text-[11px] ${
                preview ? "text-slate-500" : "text-transparent"
              }`}
              aria-live="polite"
            >
              {preview ?? "—"}
            </p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 motion-reduce:transition-none"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSet}
                onClick={onSet}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-slate-300 motion-reduce:transition-none"
              >
                Set reminder
              </button>
            </div>
          </>
        )}
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

/**
 * Human-friendly absolute timestamp used in both the preview-while-typing
 * label and the saved-reminder display. We intentionally format via plain
 * Date methods (no Intl) because the project tsconfig omits the DOM lib
 * and Intl namespace typings; this stays portable inside the prototype.
 */
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
  ] ?? "";
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
