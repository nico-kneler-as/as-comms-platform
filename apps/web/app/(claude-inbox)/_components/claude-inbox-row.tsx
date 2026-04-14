import Link from "next/link";

import type { ClaudeInboxListItemViewModel } from "../_lib/view-models";
import { ClaudeInboxAvatar } from "./claude-inbox-avatar";
import { ClaudeStageBadge } from "./claude-inbox-badge";
import { AlertIcon, MailIcon, PhoneIcon, StarIcon } from "./claude-icons";

interface RowProps {
  readonly item: ClaudeInboxListItemViewModel;
  readonly isActive: boolean;
}

export function ClaudeInboxRow({ item, isActive }: RowProps) {
  const isNew = item.bucket === "new";
  const ChannelIcon = item.latestChannel === "email" ? MailIcon : PhoneIcon;

  return (
    <li>
      <Link
        href={`/inbox/${item.contactId}`}
        aria-current={isActive ? "page" : undefined}
        className={`relative flex gap-3 border-b border-slate-100 px-5 py-3.5 transition ${
          isActive
            ? "bg-sky-50/60 ring-1 ring-inset ring-sky-200"
            : "hover:bg-slate-50/80"
        }`}
      >
        {isNew ? (
          <span
            aria-hidden="true"
            className="absolute left-0 top-0 h-full w-1 bg-sky-500"
          />
        ) : null}

        <div className="relative">
          <ClaudeInboxAvatar
            initials={item.initials}
            tone={item.avatarTone}
            size="md"
          />
          {item.hasUnresolved ? (
            <span
              className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-white ring-2 ring-white"
              aria-label="Needs review"
            >
              <AlertIcon className="h-2.5 w-2.5" />
            </span>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p
              className={`truncate text-sm ${
                isNew ? "font-semibold text-slate-900" : "text-slate-800"
              }`}
            >
              {item.displayName}
            </p>
            <span
              className={`shrink-0 text-[11px] tabular-nums ${
                isNew ? "font-semibold text-sky-700" : "text-slate-400"
              }`}
            >
              {item.lastActivityLabel}
            </span>
          </div>

          <div className="mt-0.5 flex items-center gap-1.5">
            <ChannelIcon
              className={`h-3 w-3 shrink-0 ${
                isNew ? "text-sky-600" : "text-slate-400"
              }`}
            />
            <p
              className={`truncate text-[13px] ${
                isNew ? "font-medium text-slate-800" : "text-slate-600"
              }`}
            >
              {item.latestSubject}
            </p>
            {item.isStarred ? (
              <StarIcon
                filled
                className="h-3 w-3 shrink-0 text-amber-500"
                aria-label="Starred"
              />
            ) : null}
          </div>

          <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">
            {item.snippet}
          </p>

          <div className="mt-1.5 flex items-center gap-1.5">
            <ClaudeStageBadge stage={item.volunteerStage} />
            {item.projectLabel ? (
              <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                {item.projectLabel}
              </span>
            ) : null}
            {item.unreadCount > 0 ? (
              <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-600 px-1 text-[10px] font-semibold text-white tabular-nums">
                {item.unreadCount}
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}
