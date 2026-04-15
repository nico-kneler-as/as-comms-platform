"use client";

import type { ComponentType, SVGProps } from "react";
import { useState } from "react";

import {
  AdventureScientistsLogo,
  InboxIcon,
  LogOutIcon,
  MegaphoneIcon,
  SettingsIcon
} from "./claude-icons";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface RailItem {
  readonly id: string;
  readonly label: string;
  readonly Icon: IconComponent;
  readonly active?: boolean;
}

/**
 * Prototype left nav. Kept to three destinations per product brief — Inbox,
 * Campaigns, Settings — so the icon strip doesn't drift into speculative
 * sections. The bottom slot hosts a user circle that reveals the operator's
 * name and a Log out affordance on hover.
 */
const ITEMS: readonly RailItem[] = [
  { id: "inbox", label: "Inbox", Icon: InboxIcon, active: true },
  { id: "campaigns", label: "Campaigns", Icon: MegaphoneIcon },
  { id: "settings", label: "Settings", Icon: SettingsIcon }
];

const OPERATOR = {
  initials: "JC",
  displayName: "Jordan Cole",
  email: "jordan@adventurescientists.org"
};

export function ClaudeInboxIconRail() {
  return (
    <nav
      className="flex w-14 shrink-0 flex-col items-center border-r border-slate-200 bg-white py-4"
      aria-label="Primary"
    >
      <div
        className="mb-4 flex h-9 w-9 items-center justify-center text-slate-900"
        aria-label="Adventure Scientists"
      >
        <AdventureScientistsLogo className="h-8 w-8" />
      </div>

      <div className="flex flex-1 flex-col items-center gap-1">
        {ITEMS.map((item) => {
          const Icon = item.Icon;
          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              aria-current={item.active ? "page" : undefined}
              className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-150 ${
                item.active
                  ? "bg-slate-900 text-white"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="pointer-events-none absolute left-12 z-30 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      <OperatorMenu />
    </nav>
  );
}

function OperatorMenu() {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative mt-2"
      onMouseEnter={() => {
        setOpen(true);
      }}
      onMouseLeave={() => {
        setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={`${OPERATOR.displayName} · account menu`}
        aria-expanded={open}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
        }}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-slate-800"
      >
        {OPERATOR.initials}
      </button>

      {/*
        Hover popover: transitions opacity/translate together so the
        reveal is perceptible without feeling theatrical. Pointer-events
        are disabled while hidden so the avatar still catches clicks.
      */}
      <div
        role="menu"
        aria-label="Account"
        className={`absolute bottom-0 left-12 z-30 w-56 origin-bottom-left overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg ring-1 ring-black/5 transition duration-150 ease-out ${
          open
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-1 opacity-0"
        }`}
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-3 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
            {OPERATOR.initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {OPERATOR.displayName}
            </p>
            <p className="truncate text-[11px] text-slate-500">
              {OPERATOR.email}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-50 hover:text-slate-900"
        >
          <LogOutIcon className="h-3.5 w-3.5" />
          Log out
        </button>
      </div>
    </div>
  );
}
