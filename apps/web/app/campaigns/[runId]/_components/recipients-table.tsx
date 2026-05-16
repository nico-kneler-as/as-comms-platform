"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { RecipientLatestState, RecipientRowData } from "../_lib/run-detail";
import { LocalDateTime } from "./local-date-time";
import { RunStateChip } from "./run-state-chip";

const ROW_HEIGHT = 64;
const TABLE_HEIGHT = 560;
const OVERSCAN = 6;

type RecipientFilter =
  | "all"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "unsubscribed";

const FILTER_LABELS: Record<RecipientFilter, string> = {
  all: "All",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
};

function matchesFilter(
  row: RecipientRowData,
  filter: RecipientFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "sent":
      return (
        row.latestState !== "queued" &&
        row.latestState !== "failed" &&
        row.latestState !== "suppressed"
      );
    case "delivered":
      return (
        row.latestState === "delivered" ||
        row.latestState === "opened" ||
        row.latestState === "clicked"
      );
    case "opened":
      return row.latestState === "opened" || row.latestState === "clicked";
    case "clicked":
      return row.latestState === "clicked";
    case "bounced":
      return row.latestState === "bounced";
    case "unsubscribed":
      return row.latestState === "unsubscribed";
  }
}

function rowTone(state: RecipientLatestState) {
  switch (state) {
    case "queued":
      return "draft";
    case "sent":
      return "scheduled";
    case "delivered":
      return "complete";
    case "opened":
    case "clicked":
      return "sending";
    case "bounced":
    case "unsubscribed":
    case "complained":
    case "failed":
      return "cancelled";
    case "suppressed":
      return "finalized";
  }
}

export function RecipientsTable({
  rows,
}: {
  readonly rows: readonly RecipientRowData[];
}) {
  const [filter, setFilter] = useState<RecipientFilter>("all");
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (!matchesFilter(row, filter)) {
        return false;
      }
      if (normalizedQuery.length === 0) {
        return true;
      }

      return (
        row.name.toLowerCase().includes(normalizedQuery) ||
        row.email.toLowerCase().includes(normalizedQuery) ||
        (row.project ?? "").toLowerCase().includes(normalizedQuery)
      );
    });
  }, [filter, query, rows]);

  const totalHeight = filteredRows.length * ROW_HEIGHT;
  const visibleCount = Math.ceil(TABLE_HEIGHT / ROW_HEIGHT);
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    filteredRows.length,
    startIndex + visibleCount + OVERSCAN * 2,
  );
  const visibleRows = filteredRows.slice(startIndex, endIndex);
  const offsetY = startIndex * ROW_HEIGHT;

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Recipients</h2>
          <p className="mt-1 text-sm text-slate-500">
            Search the frozen audience and jump directly into each contact&apos;s
            Inbox detail.
          </p>
        </div>
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search name, email, or project"
          className="w-full max-w-sm"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(Object.keys(FILTER_LABELS) as RecipientFilter[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setFilter(value);
            }}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              filter === value
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            {FILTER_LABELS[value]}
          </button>
        ))}
      </div>

      <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200">
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_180px_170px] border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          <div>Recipient</div>
          <div>Project</div>
          <div>Latest state</div>
          <div>Last event</div>
        </div>
        <div
          className="overflow-y-auto"
          style={{ height: `${String(TABLE_HEIGHT)}px` }}
          onScroll={(event) => {
            setScrollTop(event.currentTarget.scrollTop);
          }}
        >
          <div style={{ height: `${String(totalHeight)}px`, position: "relative" }}>
            <div style={{ transform: `translateY(${String(offsetY)}px)` }}>
              {visibleRows.map((row) => (
                <Link
                  key={row.snapshotId}
                  href={`/inbox/${encodeURIComponent(row.contactId)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_180px_170px] items-center border-b border-slate-100 px-5 py-3 text-sm transition-colors hover:bg-slate-50"
                  style={{ height: `${String(ROW_HEIGHT)}px` }}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">
                      {row.name}
                    </div>
                    <div className="truncate text-slate-500">{row.email}</div>
                  </div>
                  <div className="truncate text-slate-600">
                    {row.project ?? "No project"}
                  </div>
                  <div>
                    <RunStateChip state={rowTone(row.latestState)} />
                  </div>
                  <div className="text-slate-500">
                    {row.lastEventAt ? <LocalDateTime iso={row.lastEventAt} /> : "—"}
                  </div>
                </Link>
              ))}
            </div>

            {filteredRows.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
                No recipients match the current search or filter.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
