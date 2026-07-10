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

const ROW_HEIGHT = 56;
const TABLE_HEIGHT = 520;
const OVERSCAN = 6;
const PAGE_SIZE = 100;

const EMAIL_FILTER_LABELS: Record<RecipientFilter, string> = {
  all: "All",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
  failed: "Failed",
  suppressed: "Suppressed",
};

const SMS_FILTER_LABELS: Record<RecipientFilter, string> = {
  all: "All",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  bounced: "Failed",
  unsubscribed: "Suppressed",
  failed: "Failed",
  suppressed: "Suppressed",
};

const RECIPIENT_STATE_CLASS: Record<RecipientLatestState, string> = {
  queued: "bg-slate-100 text-slate-700 ring-slate-200",
  sent: "bg-slate-100 text-slate-700 ring-slate-200",
  delivered: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  opened: "bg-sky-50 text-sky-700 ring-sky-200",
  clicked: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  bounced: "bg-rose-50 text-rose-800 ring-rose-200",
  unsubscribed: "bg-amber-50 text-amber-800 ring-amber-200",
  complained: "bg-rose-50 text-rose-800 ring-rose-200",
  failed: "bg-rose-50 text-rose-800 ring-rose-200",
  suppressed: "bg-slate-200 text-slate-700 ring-slate-300",
};

const RECIPIENT_STATE_LABEL: Record<RecipientLatestState, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
  complained: "Complained",
  failed: "Failed",
  suppressed: "Suppressed",
};

function RecipientStateChip({ state }: { readonly state: RecipientLatestState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset",
        RECIPIENT_STATE_CLASS[state],
      )}
    >
      {RECIPIENT_STATE_LABEL[state]}
    </span>
  );
}

export function RecipientsTable({
  runId,
  provider,
  rows,
  total,
}: {
  readonly runId: string;
  readonly provider: "postmark" | "mailchimp" | "sms";
  readonly rows: readonly RecipientRowData[];
  readonly total: number;
}) {
  const isSms = provider === "sms";
  const filterLabels = isSms ? SMS_FILTER_LABELS : EMAIL_FILTER_LABELS;
  const visibleFilters = isSms
    ? (["all", "sent", "delivered", "failed", "suppressed"] as const)
    : ([
        "all",
        "sent",
        "delivered",
        "opened",
        "clicked",
        "bounced",
        "unsubscribed",
      ] as const);
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
        provider,
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
  }, [deferredQuery, filter, provider, runId]);

  function loadMore() {
    startTransition(async () => {
      const result = await listCampaignRecipients({
        runId,
        provider,
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
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
            Recipients · {serverTotal.toLocaleString()}
          </h2>
          <span
            className="text-[10.5px] tabular-nums text-slate-400"
            aria-live="polite"
          >
            Showing {serverRows.length.toLocaleString()} of{" "}
            {serverTotal.toLocaleString()}
            {pending ? " · Updating…" : ""}
          </span>
        </div>
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder={isSms ? "Search name or phone" : "Search name, email, or project"}
          className="h-8 w-full max-w-[260px] text-[12px]"
        />
      </div>

      {errorMessage ? (
        <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-3 py-2">
        {visibleFilters.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setFilter(value);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors",
              filter === value
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-100",
            )}
          >
            {filterLabels[value]}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_160px_150px] border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
            <div>Recipient</div>
            <div>{isSms ? "Phone" : "Project"}</div>
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
                {visibleRows.map((row) =>
                  row.contactId === null ? (
                    <div
                      key={row.snapshotId}
                      className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_160px_150px] items-center border-b border-slate-100 px-4 py-2 text-[12.5px]"
                      style={{ height: `${String(ROW_HEIGHT)}px` }}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-900">
                          {row.name}
                        </div>
                        <div className="truncate text-[11.5px] text-slate-500">
                          {isSms
                            ? (row.phone ?? "No phone")
                            : (row.email ?? "No email retained from import")}
                        </div>
                        <div
                          className="mt-1 text-[10.5px] text-slate-400"
                          title="No matching contact in canonical store"
                        >
                          Inbox unavailable
                        </div>
                      </div>
                      <div className="truncate text-slate-600">
                        {isSms ? (row.phone ?? "No phone") : (row.project ?? "No project")}
                      </div>
                      <div>
                        <RecipientStateChip state={row.latestState} />
                      </div>
                      <div className="text-slate-500">
                        {row.lastEventAt ? (
                          <LocalDateTime iso={row.lastEventAt} />
                        ) : (
                          "-"
                        )}
                      </div>
                    </div>
                  ) : (
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
                          {isSms
                            ? (row.phone ?? "No phone")
                            : (row.email ?? "No email retained from import")}
                        </div>
                      </div>
                      <div className="truncate text-slate-600">
                        {isSms ? (row.phone ?? "No phone") : (row.project ?? "No project")}
                      </div>
                      <div>
                        <RecipientStateChip state={row.latestState} />
                      </div>
                      <div className="text-slate-500">
                        {row.lastEventAt ? (
                          <LocalDateTime iso={row.lastEventAt} />
                        ) : (
                          "-"
                        )}
                      </div>
                    </Link>
                  ),
                )}
              </div>

              {serverRows.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[12.5px] text-slate-500">
                  <span>No recipients match the current search or filter.</span>
                  {filter !== "all" || query.trim().length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setFilter("all");
                        setQuery("");
                      }}
                      className="text-[11.5px] font-medium text-slate-700 underline underline-offset-4 hover:text-slate-900"
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {hasMoreRows ? (
        <div className="mx-4 mb-4 mt-4 flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={pending}>
            {pending ? "Loading recipients..." : "Load more recipients"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
