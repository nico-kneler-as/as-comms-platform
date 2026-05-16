"use client";

import { useMemo } from "react";

import { ORG_TIMEZONE } from "@/app/_lib/org-timezone";

export function LocalDateTime({ iso }: { readonly iso: string }) {
  const label = useMemo(() => {
    const date = new Date(iso);
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
