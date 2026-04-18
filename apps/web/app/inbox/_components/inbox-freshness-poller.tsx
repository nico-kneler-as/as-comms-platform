"use client";

import { useEffect, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";

import type {
  InboxDetailViewModel,
  InboxListViewModel
} from "../_lib/view-models";
import { fetchInboxFreshness } from "../_lib/client-api";

interface FreshnessPollerProps {
  readonly listFreshness?: InboxListViewModel["freshness"];
  readonly detailFreshness?: InboxDetailViewModel["freshness"];
  readonly contactId?: string;
  readonly intervalMs?: number;
}

export function listFreshnessChanged(
  current: InboxListViewModel["freshness"] | undefined,
  next: InboxListViewModel["freshness"]
): boolean {
  if (current === undefined) {
    return false;
  }

  return (
    current.latestUpdatedAt !== next.latestUpdatedAt ||
    current.total !== next.total
  );
}

export function detailFreshnessChanged(
  current: InboxDetailViewModel["freshness"] | undefined,
  next: InboxDetailViewModel["freshness"] | null
): boolean {
  if (current === undefined) {
    return false;
  }

  if (next === null) {
    return true;
  }

  return (
    current.inboxUpdatedAt !== next.inboxUpdatedAt ||
    current.timelineUpdatedAt !== next.timelineUpdatedAt ||
    current.timelineCount !== next.timelineCount
  );
}

export function InboxFreshnessPoller({
  listFreshness,
  detailFreshness,
  contactId,
  intervalMs = 30000
}: FreshnessPollerProps) {
  const router = useRouter();
  const latestRef = useRef({
    listFreshness,
    detailFreshness,
    contactId
  });

  useEffect(() => {
    latestRef.current = {
      listFreshness,
      detailFreshness,
      contactId
    };
  }, [contactId, detailFreshness, listFreshness]);

  useEffect(() => {
    const pollFreshness = async () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }

      try {
        const current = latestRef.current;
        const next = await fetchInboxFreshness(current.contactId);

        if (
          listFreshnessChanged(current.listFreshness, next.list) ||
          detailFreshnessChanged(current.detailFreshness, next.detail)
        ) {
          startTransition(() => {
            router.refresh();
          });
        }
      } catch {
        // Polling is best effort. The next interval or user navigation will retry.
      }
    };

    const intervalId = window.setInterval(() => {
      void pollFreshness();
    }, intervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void pollFreshness();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [intervalMs, router]);

  return null;
}
