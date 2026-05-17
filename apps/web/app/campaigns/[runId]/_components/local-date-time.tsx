"use client";

import { useMemo } from "react";

import { ORG_TIMEZONE } from "@/app/_lib/org-timezone";

const LOCAL_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: ORG_TIMEZONE,
  timeZoneName: "short",
});

export function LocalDateTime({ iso }: { readonly iso: string }) {
  const label = useMemo(() => {
    const date = new Date(iso);
    return LOCAL_DATE_TIME_FORMATTER.format(date);
  }, [iso]);

  return (
    <time dateTime={iso} suppressHydrationWarning>
      {label}
    </time>
  );
}
