"use client";

import { useMemo } from "react";

export function LocalDateTime({
  iso,
}: {
  readonly iso: string;
}) {
  const label = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    return formatter.format(new Date(iso));
  }, [iso]);

  return (
    <time dateTime={iso} suppressHydrationWarning>
      {label}
    </time>
  );
}
