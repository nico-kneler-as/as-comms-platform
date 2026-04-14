"use client";

import { usePathname } from "next/navigation";

import type { ClaudeInboxListItemViewModel } from "../_lib/view-models.js";
import { ClaudeInboxRow } from "./claude-inbox-row.js";

interface ListProps {
  readonly items: readonly ClaudeInboxListItemViewModel[];
}

/**
 * Client island: renders the contact list and highlights the active row
 * based on the current pathname. The list itself never owns or mutates
 * canonical state — items flow in from the server.
 */
export function ClaudeInboxList({ items }: ListProps) {
  const pathname = usePathname();
  const activeContactId = extractContactId(pathname);

  if (items.length === 0) {
    return (
      <div className="px-5 py-16 text-center">
        <p className="text-sm font-medium text-slate-700">Nothing to show</p>
        <p className="mt-1 text-xs text-slate-500">
          Try a different filter, or wait for new activity.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => (
        <ClaudeInboxRow
          key={item.contactId}
          item={item}
          isActive={item.contactId === activeContactId}
        />
      ))}
    </ul>
  );
}

function extractContactId(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = /^\/inbox\/([^/]+)/.exec(pathname);
  return match ? (match[1] ?? null) : null;
}
