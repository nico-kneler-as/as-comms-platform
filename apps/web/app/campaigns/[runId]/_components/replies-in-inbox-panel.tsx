import Link from "next/link";

import type { ReplyPreviewRow } from "../_lib/run-detail";
import { LocalDateTime } from "./local-date-time";

export function RepliesInInboxPanel({
  repliesCount,
  recentReplies,
  href,
}: {
  readonly repliesCount: number;
  readonly recentReplies: readonly ReplyPreviewRow[];
  readonly href: string;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Replies in Inbox
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {repliesCount.toLocaleString()} inbound repl
            {repliesCount === 1 ? "y" : "ies"} after the run completed.
          </p>
        </div>
        <Link
          href={href}
          className="text-sm font-medium text-slate-900 underline underline-offset-4"
        >
          Open Inbox filtered to recipients →
        </Link>
      </div>

      <div className="mt-4 space-y-3">
        {recentReplies.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            No replies have landed in Inbox yet.
          </div>
        ) : (
          recentReplies.map((reply) => (
            <Link
              key={`${reply.contactId}:${reply.occurredAt}`}
              href={`/inbox/${encodeURIComponent(reply.contactId)}`}
              target="_blank"
              rel="noreferrer"
              className="block rounded-xl border border-slate-200 px-4 py-3 transition-colors hover:bg-slate-50"
            >
              <div className="text-sm font-medium text-slate-900">
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
