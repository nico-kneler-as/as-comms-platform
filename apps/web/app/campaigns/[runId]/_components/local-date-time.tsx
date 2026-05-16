"use client";

import { useMemo } from "react";

import { ORG_TIMEZONE } from "@/app/_lib/org-timezone";

function formatRelative(date: Date, now: Date): string | null {
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0 || diffMs > 24 * 60 * 60 * 1000) {
    return null;
  }

  const diffMinutes = Math.max(1, Math.floor(diffMs / 60_000));
  if (diffMinutes < 60) {
    return `${diffMinutes.toString()}m ago`;
  }

  return `${Math.floor(diffMinutes / 60).toString()}h ago`;
}

export function LocalDateTime({ iso }: { readonly iso: string }) {
  const label = useMemo(() => {
    const date = new Date(iso);
    const relative = formatRelative(date, new Date());
    if (relative !== null) {
      return relative;
    }

    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: ORG_TIMEZONE,
      timeZoneName: "short",
    });

    return formatter.format(date);
  }, [iso]);

  return (
    <time dateTime={iso} suppressHydrationWarning>
      {label}
    </time>
  );
}
