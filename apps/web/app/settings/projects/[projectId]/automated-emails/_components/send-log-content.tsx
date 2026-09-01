"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronRight, Eye, Info, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import {
  AUTOMATED_EMAIL_SEND_STATUS_META,
  formatAutomatedEmailSendReason,
} from "@/src/lib/automated-email-send-presentation";
import type {
  AutomatedEmailEditorViewModel,
  AutomatedEmailSendLogRowViewModel,
} from "@/src/server/automated-email/selectors";

import { loadSendLogPageAction, sendAutomatedEmailNowAction } from "../actions";

const STATUS_COLOR_CLASSES = {
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  slate: "bg-slate-100 text-slate-600 ring-slate-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
} as const;

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))}m ago`;
  if (seconds < 86400) return `${String(Math.floor(seconds / 3600))}h ago`;
  return `${String(Math.floor(seconds / 86400))}d ago`;
}

function absoluteTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function SendStatusBadge({
  status,
}: {
  readonly status: AutomatedEmailSendLogRowViewModel["status"];
}) {
  const meta = AUTOMATED_EMAIL_SEND_STATUS_META[status];
  return (
    <StatusBadge
      label={meta.label}
      variant="soft"
      colorClasses={STATUS_COLOR_CLASSES[meta.tone]}
    />
  );
}

function EmailPreview({
  preview,
}: {
  readonly preview: AutomatedEmailSendLogRowViewModel["renderedPreview"];
}) {
  if (preview === null) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
        <p className="text-[12.5px] font-medium text-slate-700">
          No rendered email is available
        </p>
        <p className="mx-auto mt-1 max-w-[36ch] text-[11.5px] leading-relaxed text-slate-500">
          This outcome did not render an email, so there is nothing to preview.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-slate-200 bg-slate-50/70 px-3 py-2 text-[10.5px]">
        <span className="text-slate-500">Subject</span>
        <span className="truncate font-medium text-slate-900">
          {preview.subject}
        </span>
      </div>
      <div className="h-[590px] overflow-hidden bg-[#fafbf9]">
        <iframe
          title="Rendered automated email"
          srcDoc={preview.html}
          sandbox="allow-same-origin"
          className="origin-top-left border-0"
          style={{ width: 600, height: 700, transform: "scale(0.83)" }}
        />
      </div>
      <div className="border-t border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        <Info className="mr-1 inline size-3 -translate-y-px" />
        Frame, type and spacing are fixed by code.
      </div>
    </div>
  );
}

function SendFacts({
  row,
  templateName,
}: {
  readonly row: AutomatedEmailSendLogRowViewModel;
  readonly templateName: string;
}) {
  const outcome = `${AUTOMATED_EMAIL_SEND_STATUS_META[row.status].label}${
    row.statusReason === null
      ? ""
      : ` — ${formatAutomatedEmailSendReason(row.statusReason)}`
  }`;
  return (
    <div className="flex flex-col gap-3">
      {row.status === "held" ? (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200/70">
          <span className="font-semibold">
            {row.statusReason === "inactive_dry_run" ? "Dry run." : "Held."}
          </span>{" "}
          {row.statusReason === "inactive_dry_run"
            ? "This is what would have gone out. Activating the template enables future sends."
            : "Nothing was sent and nothing was lost. Fix the cause, then release this row when it is ready."}
        </div>
      ) : null}
      <dl className="overflow-hidden rounded-md border border-slate-200 bg-white">
        {[
          ["Received", absoluteTime(row.receivedAt)],
          ["Member", row.memberName],
          ["Address", row.memberEmail ?? "—"],
          ["Outcome", outcome],
          ["Template", templateName],
        ].map(([term, description], index, facts) => (
          <div
            key={term}
            className={cn(
              "grid grid-cols-[112px_minmax(0,1fr)] gap-3 px-3 py-2",
              index < facts.length - 1 && "border-b border-slate-200/70",
            )}
          >
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {term}
            </dt>
            <dd className="min-w-0 break-words text-[12.5px] text-slate-700">
              {description}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SendLogDrawer({
  row,
  templateName,
  onClose,
  onSendNow,
  pending,
  message,
}: {
  readonly row: AutomatedEmailSendLogRowViewModel;
  readonly templateName: string;
  readonly onClose: () => void;
  readonly onSendNow: () => void;
  readonly pending: boolean;
  readonly message: string | null;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close send details"
        className="absolute inset-0 bg-slate-950/25"
        onClick={onClose}
      />
      <aside
        aria-label="Send details"
        className="absolute right-0 top-0 flex h-full w-[560px] max-w-[calc(100vw-1rem)] flex-col bg-white shadow-2xl ring-1 ring-slate-200"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold text-slate-900">
              {row.memberName}
            </h2>
            <div className="mt-0.5 flex items-center gap-2 text-[12px] text-slate-500">
              <span>{relativeTime(row.receivedAt)}</span>
              <span className="size-1 rounded-full bg-slate-300" />
              <SendStatusBadge status={row.status} />
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-slate-500"
            onClick={onClose}
            aria-label="Close send details"
          >
            <X className="size-4" />
          </Button>
        </header>
        <div className="flex-1 overflow-auto px-5 py-4">
          <SendFacts row={row} templateName={templateName} />
          <div className="mt-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Rendered email
            </p>
            <div className="mt-1.5">
              <EmailPreview preview={row.renderedPreview} />
            </div>
          </div>
        </div>
        <footer className="flex min-h-[60px] items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-5 py-3">
          <div className="min-w-0 text-[11.5px] leading-snug text-slate-500">
            {message ??
              (row.status === "held"
                ? "Queues a fresh evaluation. If the template is still inactive, it will hold again as a dry run."
                : "Rendered with this member’s real values.")}
          </div>
          {row.status === "held" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSendNow}
              disabled={pending}
              className="shrink-0"
            >
              <Send className="size-3" /> {pending ? "Queueing…" : "Send now"}
            </Button>
          ) : null}
        </footer>
      </aside>
    </div>
  );
}

export function AutomatedEmailSendLogContent({
  data,
  active,
  hasPublishedCopy,
}: {
  readonly data: AutomatedEmailEditorViewModel;
  readonly active: boolean;
  readonly hasPublishedCopy: boolean;
}) {
  const router = useRouter();
  const [page, setPage] = useState(
    data.initialSendLog,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const statuses = ["sent", "duplicate", "held", "failed"] as const;
  const total =
    data.sendCounts.received +
    statuses.reduce((sum, status) => sum + data.sendCounts[status], 0);
  const selected = page.items.find((row) => row.id === selectedId) ?? null;

  useEffect(() => {
    setPage(data.initialSendLog);
  }, [data.initialSendLog]);

  function loadMore() {
    if (page.nextCursor === null) return;
    startTransition(async () => {
      const result = await loadSendLogPageAction({
        projectId: data.projectId,
        templateId: data.template.id,
        cursor: page.nextCursor,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setPage((current) => ({
        items: [...current.items, ...result.data.items],
        nextCursor: result.data.nextCursor,
      }));
    });
  }

  function sendNow() {
    if (selected?.status !== "held") return;
    setMessage(null);
    startTransition(async () => {
      const result = await sendAutomatedEmailNowAction({
        projectId: data.projectId,
        templateId: data.template.id,
        sendId: selected.id,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setPage((current) => ({
        ...current,
        items: current.items.map((row) =>
          row.id === selected.id
            ? { ...row, status: "received", statusReason: null }
            : row,
        ),
      }));
      setMessage("Queued for a fresh evaluation.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 pt-4">
      <section className="flex items-center gap-6 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Last sent
          </p>
          <p className="mt-1 text-[11.5px] text-slate-700">
            {data.lastReceivedAt === null
              ? "No webhook yet"
              : relativeTime(data.lastReceivedAt)}
          </p>
        </div>
        <Separator orientation="vertical" className="h-8 bg-slate-200" />
        <div className="flex items-center gap-5">
          {statuses.map((status) => (
            <div key={status}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {AUTOMATED_EMAIL_SEND_STATUS_META[status].label}
              </p>
              <p
                className={cn(
                  "mt-0.5 text-[15px] font-semibold tabular-nums",
                  data.sendCounts[status] > 0
                    ? "text-slate-900"
                    : "text-slate-300",
                )}
              >
                {String(data.sendCounts[status])}
              </p>
            </div>
          ))}
        </div>
        {active && !hasPublishedCopy && data.sendCounts.held > 0 ? (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-1 text-[11.5px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
            <Info className="size-3.5" /> Holding — no published copy
          </span>
        ) : null}
      </section>

      {total === 0 ? (
        <section className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-10 text-center">
          <h2 className="text-[13.5px] font-medium text-slate-900">
            Nothing has come through yet
          </h2>
          <p className="mx-auto mt-1 max-w-[46ch] text-[12px] leading-relaxed text-slate-500">
            When the Salesforce flow fires at this template’s ID, rows land here
            — including while the template is inactive. That’s the dry run: you
            read what would have gone out, then activate.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[130px_minmax(0,1fr)_110px_minmax(0,1.1fr)_20px] items-center gap-4 border-b border-slate-200/70 bg-slate-50/80 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            <span>Received</span>
            <span>Expedition member</span>
            <span>Status</span>
            <span>Reason</span>
            <span />
          </div>
          {page.items.map((row, index) => (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                setSelectedId(row.id);
                setMessage(null);
              }}
              onKeyDown={(event) => {
                if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  setSelectedId(row.id);
                  setMessage(null);
                }
              }}
              className={cn(
                "grid w-full grid-cols-[130px_minmax(0,1fr)_110px_minmax(0,1.1fr)_20px] items-center gap-4 px-4 py-2.5 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400",
                index < page.items.length - 1 && "border-b border-slate-200/60",
              )}
            >
              <time
                dateTime={row.receivedAt}
                title={absoluteTime(row.receivedAt)}
                className="text-[12.5px] tabular-nums text-slate-700"
              >
                {relativeTime(row.receivedAt)}
              </time>
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-slate-900">
                  {row.memberName}
                </span>
                <span className="block truncate font-mono text-[11px] text-slate-500">
                  {row.memberEmail ?? "—"}
                </span>
              </span>
              <span>
                <SendStatusBadge status={row.status} />
              </span>
              <span className="truncate text-[12px] text-slate-500">
                {formatAutomatedEmailSendReason(row.statusReason)}
              </span>
              <Eye className="size-3.5 text-slate-400" />
            </button>
          ))}
        </section>
      )}

      {message !== null && selected === null ? (
        <p
          role="alert"
          className="rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700"
        >
          {message}
        </p>
      ) : null}

      {page.nextCursor !== null ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={loadMore}
          >
            {pending ? "Loading…" : "Load more"}
            <ChevronRight className="size-3" />
          </Button>
        </div>
      ) : null}
      {selected !== null ? (
        <SendLogDrawer
          row={selected}
          templateName={data.template.name}
          onClose={() => {
            setSelectedId(null);
            setMessage(null);
          }}
          onSendNow={sendNow}
          pending={pending}
          message={message}
        />
      ) : null}
    </div>
  );
}
