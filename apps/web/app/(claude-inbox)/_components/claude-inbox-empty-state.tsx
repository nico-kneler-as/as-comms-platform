import { InboxIcon } from "./claude-icons";

export function ClaudeInboxEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <InboxIcon className="h-7 w-7" />
      </div>
      <h2 className="mt-5 text-base font-semibold text-slate-900">
        Select a person to begin
      </h2>
      <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
        The Inbox is organized by person. Choose anyone on the left to see
        their full communication history, context, and reply workflow in
        one place.
      </p>
    </div>
  );
}
