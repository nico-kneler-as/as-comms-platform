import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import type { ReplyPreviewRow } from "../_lib/run-detail";
import { LocalDateTime } from "./local-date-time";

export function RepliesInInboxPanel({
  repliesCount,
  recentReplies,
  href,
  subtitle,
  emptyMessage,
  showInboxLink = true,
}: {
  readonly repliesCount: number;
  readonly recentReplies: readonly ReplyPreviewRow[];
  readonly href: string;
  readonly subtitle?: string;
  readonly emptyMessage?: string;
  readonly showInboxLink?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
          Replies in Inbox
        </h2>
        {showInboxLink ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 hover:text-slate-900"
          >
            Open in Inbox
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </Link>
        ) : null}
      </div>

      <div className="px-4 pt-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[20px] font-semibold tabular-nums text-slate-900">
            {repliesCount.toLocaleString()}
          </span>
          <span className="text-[11.5px] text-slate-500">
            {subtitle ??
              `inbound repl${repliesCount === 1 ? "y" : "ies"} after the run completed`}
          </span>
        </div>
      </div>

      <div className="space-y-2 px-4 py-3">
        {recentReplies.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] text-slate-500">
            {emptyMessage ?? "No replies have landed in Inbox yet."}
          </div>
        ) : (
          recentReplies.map((reply) => (
            <Link
              key={`${reply.contactId}:${reply.occurredAt}`}
              href={`/inbox/${encodeURIComponent(reply.contactId)}`}
              target="_blank"
              rel="noreferrer"
              className="block rounded-md border border-slate-200 bg-white px-3 py-2 transition-colors hover:bg-slate-50"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-medium text-slate-900">
                  {reply.contactName}
                </span>
                <span className="text-[10.5px] tabular-nums text-slate-500">
                  <LocalDateTime iso={reply.occurredAt} />
                </span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-500">
                {reply.email ?? "No email"}
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
