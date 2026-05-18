"use client";

import Link from "next/link";
import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { listCampaignRecipients } from "../../actions";
import type {
  RecipientFilter,
  RecipientLatestState,
  RecipientRowData,
} from "../../_lib/run-recipients";
import { LocalDateTime } from "./local-date-time";
import { RunStateChip } from "./run-state-chip";

const ROW_HEIGHT = 56;
const TABLE_HEIGHT = 520;
const OVERSCAN = 6;
const PAGE_SIZE = 100;

const FILTER_LABELS: Record<RecipientFilter, string> = {
  all: "All",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
};

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
  runId,
  rows,
  total,
}: {
  readonly runId: string;
  readonly rows: readonly RecipientRowData[];
  readonly total: number;
}) {
  const [filter, setFilter] = useState<RecipientFilter>("all");
  const [query, setQuery] = useState("");
  const [serverRows, setServerRows] = useState(rows);
  const [serverTotal, setServerTotal] = useState(total);
  const [scrollTop, setScrollTop] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const deferredQuery = useDeferredValue(query);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const queryKeyRef = useRef(`${filter}:${deferredQuery}`);

  useEffect(() => {
    setServerRows(rows);
    setServerTotal(total);
  }, [rows, total]);

  useEffect(() => {
    const queryKey = `${filter}:${deferredQuery}`;
    if (queryKeyRef.current === queryKey) {
      return;
    }

    queryKeyRef.current = queryKey;
    setScrollTop(0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }

    let cancelled = false;
    startTransition(async () => {
      const result = await listCampaignRecipients({
        runId,
        filter,
        query: deferredQuery,
        limit: PAGE_SIZE,
        offset: 0,
      });
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setErrorMessage(result.message);
        return;
      }

      setErrorMessage(null);
      setServerRows(result.data.rows);
      setServerTotal(result.data.total);
    });

    return () => {
      cancelled = true;
    };
  }, [deferredQuery, filter, runId]);

  function loadMore() {
    startTransition(async () => {
      const result = await listCampaignRecipients({
        runId,
        filter,
        query: deferredQuery,
        limit: PAGE_SIZE,
        offset: serverRows.length,
      });
      if (!result.ok) {
        setErrorMessage(result.message);
        return;
      }

      setErrorMessage(null);
      setServerRows((currentRows) => [...currentRows, ...result.data.rows]);
      setServerTotal(result.data.total);
    });
  }

  const hasMoreRows = serverRows.length < serverTotal;
  const totalHeight = serverRows.length * ROW_HEIGHT;
  const visibleCount = Math.ceil(TABLE_HEIGHT / ROW_HEIGHT);
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    serverRows.length,
    startIndex + visibleCount + OVERSCAN * 2,
  );
  const visibleRows = serverRows.slice(startIndex, endIndex);
  const offsetY = startIndex * ROW_HEIGHT;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Recipients</h2>
          <p className="mt-1 text-[12.5px] text-slate-500">
            Search the frozen audience and jump directly into each
            contact&apos;s Inbox detail.
          </p>
          <p className="mt-1 text-xs text-slate-500" aria-live="polite">
            Showing {serverRows.length.toLocaleString()} of{" "}
            {serverTotal.toLocaleString()} recipients
            {pending ? " · Updating..." : ""}
          </p>
        </div>
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search name, email, or project"
          className="h-9 w-full max-w-sm text-[13px]"
        />
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {(Object.keys(FILTER_LABELS) as RecipientFilter[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setFilter(value);
            }}
            className={cn(
              "rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
              filter === value
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            {FILTER_LABELS[value]}
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_160px_150px] border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
            <div>Recipient</div>
            <div>Project</div>
            <div>Latest state</div>
            <div>Last event</div>
          </div>
          <div
            ref={scrollContainerRef}
            className="overflow-y-auto"
            style={{ height: `${String(TABLE_HEIGHT)}px` }}
            onScroll={(event) => {
              setScrollTop(event.currentTarget.scrollTop);
            }}
          >
            <div
              style={{
                height: `${String(totalHeight)}px`,
                position: "relative",
              }}
            >
              <div style={{ transform: `translateY(${String(offsetY)}px)` }}>
                {visibleRows.map((row) => (
                  <Link
                    key={row.snapshotId}
                    href={`/inbox/${encodeURIComponent(row.contactId)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_160px_150px] items-center border-b border-slate-100 px-4 py-2 text-[12.5px] transition-colors hover:bg-slate-50"
                    style={{ height: `${String(ROW_HEIGHT)}px` }}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900">
                        {row.name}
                      </div>
                      <div className="truncate text-[11.5px] text-slate-500">
                        {row.email}
                      </div>
                    </div>
                    <div className="truncate text-slate-600">
                      {row.project ?? "No project"}
                    </div>
                    <div>
                      <RunStateChip state={rowTone(row.latestState)} />
                    </div>
                    <div className="text-slate-500">
                      {row.lastEventAt ? (
                        <LocalDateTime iso={row.lastEventAt} />
                      ) : (
                        "-"
                      )}
                    </div>
                  </Link>
                ))}
              </div>

              {serverRows.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center text-[12.5px] text-slate-500">
                  No recipients match the current search or filter.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {hasMoreRows ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={pending}>
            {pending ? "Loading recipients..." : "Load more recipients"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
