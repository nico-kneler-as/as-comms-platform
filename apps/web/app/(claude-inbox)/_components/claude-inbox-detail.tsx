import type { ClaudeInboxDetailViewModel } from "../_lib/view-models";
import { ClaudeBucketBadge } from "./claude-inbox-badge";
import { ClaudeInboxComposer } from "./claude-inbox-composer";
import { ClaudeInboxContactRail } from "./claude-inbox-contact-rail";
import { ClaudeInboxTimeline } from "./claude-inbox-timeline";
import { AlertIcon, StarIcon } from "./claude-icons";

interface DetailProps {
  readonly detail: ClaudeInboxDetailViewModel;
}

export function ClaudeInboxDetail({ detail }: DetailProps) {
  const { contact, timeline, bucket, isStarred, smsEligible } = detail;

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col border-r border-slate-200 bg-white">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold text-slate-900">
                {contact.displayName}
              </h1>
              <ClaudeBucketBadge bucket={bucket} />
              {isStarred ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
                  aria-label="Starred for follow-up"
                >
                  <StarIcon filled className="h-3 w-3" />
                  Starred
                </span>
              ) : null}
              {contact.hasUnresolved ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
                  aria-label="Needs manual review"
                >
                  <AlertIcon className="h-3 w-3" />
                  Needs review
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {contact.primaryEmail ?? contact.primaryPhone ?? "No primary channel"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <StarIcon className="h-3.5 w-3.5" />
              {isStarred ? "Unstar" : "Star"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Mark opened
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-50/40 px-6 py-6">
          <ClaudeInboxTimeline entries={timeline} />
        </div>

        <ClaudeInboxComposer
          contactDisplayName={contact.displayName}
          smsEligible={smsEligible}
        />
      </section>

      <ClaudeInboxContactRail contact={contact} />
    </div>
  );
}
