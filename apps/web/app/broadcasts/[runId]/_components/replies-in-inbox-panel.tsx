import Link from "next/link";

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
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Replies in Inbox
          </h2>
          <p className="mt-1 text-[12px] text-slate-500">
            {subtitle ??
              `${repliesCount.toLocaleString()} inbound repl${
                repliesCount === 1 ? "y" : "ies"
              } after the run completed.`}
          </p>
        </div>
        {showInboxLink ? (
          <Link
            href={href}
            className="text-[12px] font-medium text-slate-900 underline underline-offset-4"
          >
            Open Inbox filtered to recipients
          </Link>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        {recentReplies.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
            {emptyMessage ?? "No replies have landed in Inbox yet."}
          </div>
        ) : (
          recentReplies.map((reply) => (
            <Link
              key={`${reply.contactId}:${reply.occurredAt}`}
              href={`/inbox/${encodeURIComponent(reply.contactId)}`}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg border border-slate-200 px-3 py-2.5 transition-colors hover:bg-slate-50"
            >
              <div className="text-[12.5px] font-medium text-slate-900">
                {reply.contactName}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {reply.email ?? "No email"} ·{" "}
                <LocalDateTime iso={reply.occurredAt} />
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
