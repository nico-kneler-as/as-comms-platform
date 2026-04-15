"use client";

import { useState } from "react";

import type { ClaudeInboxDetailViewModel } from "../_lib/view-models";
import { ClaudeInboxComposer } from "./claude-inbox-composer";
import {
  ClaudeInboxContactRail,
  ProjectStatusBadge
} from "./claude-inbox-contact-rail";
import { ClaudeInboxTimeline } from "./claude-inbox-timeline";
import {
  ClockIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon
} from "./claude-icons";

interface DetailProps {
  readonly detail: ClaudeInboxDetailViewModel;
}

type ReminderUnit = "hours" | "days" | "weeks";

/**
 * Client island: owns the right-rail disclosure state (`railOpen`) and the
 * inline "Set a Reminder" popover state. All canonical data still flows
 * down from the server selector — the client only toggles local UI.
 */
export function ClaudeInboxDetail({ detail }: DetailProps) {
  const { contact, timeline, smsEligible } = detail;
  const [railOpen, setRailOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderValue, setReminderValue] = useState("");
  const [reminderUnit, setReminderUnit] = useState<ReminderUnit>("hours");

  const activeProject = contact.activeProjects[0] ?? null;
  const firstName = contact.displayName.split(" ")[0] ?? contact.displayName;

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col border-r border-slate-200 bg-white">
        <header className="flex h-[65px] items-center justify-between gap-4 border-b border-slate-200 px-6">
          <div className="flex min-w-0 items-center gap-4">
            <h1 className="truncate text-lg font-semibold text-slate-900">
              {contact.displayName}
            </h1>
            <div className="hidden h-5 w-px bg-slate-200 sm:block" />
            <div className="hidden min-w-0 sm:block">
              {activeProject ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="truncate font-medium text-slate-700">
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
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Needs Follow Up
            </button>

            <div className="relative">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={reminderOpen}
                onClick={() => {
                  setReminderOpen((open) => !open);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm transition ${
                  reminderOpen
                    ? "border-slate-300 bg-slate-100 text-slate-900"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <ClockIcon className="h-3.5 w-3.5" />
                Set a Reminder
              </button>
              {reminderOpen ? (
                <ReminderPopover
                  value={reminderValue}
                  unit={reminderUnit}
                  onChangeValue={setReminderValue}
                  onChangeUnit={setReminderUnit}
                  onClose={() => {
                    setReminderOpen(false);
                  }}
                />
              ) : null}
            </div>

            {railOpen ? (
              <button
                type="button"
                aria-label="Collapse volunteer details"
                aria-expanded={true}
                aria-controls="claude-inbox-contact-rail"
                onClick={() => {
                  setRailOpen(false);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-900 shadow-sm transition hover:bg-slate-200"
              >
                <PanelRightCloseIcon className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                aria-label="Expand volunteer details"
                aria-expanded={false}
                aria-controls="claude-inbox-contact-rail"
                onClick={() => {
                  setRailOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <PanelRightOpenIcon className="h-3.5 w-3.5" />
                Volunteer Details
              </button>
            )}
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
  readonly value: string;
  readonly unit: ReminderUnit;
  readonly onChangeValue: (value: string) => void;
  readonly onChangeUnit: (unit: ReminderUnit) => void;
  readonly onClose: () => void;
}

const REMINDER_UNITS: readonly ReminderUnit[] = ["hours", "days", "weeks"];

function ReminderPopover({
  value,
  unit,
  onChangeValue,
  onChangeUnit,
  onClose
}: ReminderPopoverProps) {
  const canSet = value.length > 0 && Number(value) > 0;

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
        className="absolute right-0 top-full z-30 mt-2 w-64 origin-top-right overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-lg ring-1 ring-black/5"
      >
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
              // tsconfig omits the DOM lib so we narrow through unknown to
              // reach `.value`. We also strip non-digits defensively.
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
                  className={`flex-1 rounded-md px-1.5 py-1 capitalize transition ${
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
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSet}
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Set reminder
          </button>
        </div>
      </div>
    </>
  );
}
