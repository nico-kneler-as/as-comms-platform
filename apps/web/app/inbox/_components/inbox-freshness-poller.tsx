"use client";

import { useEffect, useRef, startTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import type {
  InboxDetailViewModel,
  InboxListViewModel,
} from "../_lib/view-models";
import { fetchInboxFreshness } from "../_lib/client-api";
import { extractInboxContactId } from "./inbox-keyboard-helpers";

interface FreshnessPollerProps {
  readonly listFreshness?: InboxListViewModel["freshness"];
  readonly detailFreshness?: InboxDetailViewModel["freshness"];
  readonly contactId?: string;
  readonly intervalMs?: number;
}

export function listFreshnessChanged(
  current: InboxListViewModel["freshness"] | undefined,
  next: InboxListViewModel["freshness"],
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
  next: InboxDetailViewModel["freshness"] | null,
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
  intervalMs = 60000,
}: FreshnessPollerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const activeRouteContactId = extractInboxContactId(pathname);
  const shouldPauseListPoller =
    contactId === undefined && activeRouteContactId !== null;
  const latestRef = useRef({
    listFreshness,
    detailFreshness,
    contactId,
    shouldPauseListPoller,
  });
  const isPollingRef = useRef(false);
  const hasRefreshInFlightRef = useRef(false);

  useEffect(() => {
    latestRef.current = {
      listFreshness,
      detailFreshness,
      contactId,
      shouldPauseListPoller,
    };
    hasRefreshInFlightRef.current = false;
  }, [contactId, detailFreshness, listFreshness, shouldPauseListPoller]);

  useEffect(() => {
    const pollFreshness = async () => {
      if (isPollingRef.current || hasRefreshInFlightRef.current) {
        return;
      }

      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }

      isPollingRef.current = true;

      try {
        const current = latestRef.current;
        if (current.shouldPauseListPoller) {
          return;
        }

        const next = await fetchInboxFreshness(current.contactId);

        if (
          listFreshnessChanged(current.listFreshness, next.list) ||
          detailFreshnessChanged(current.detailFreshness, next.detail)
        ) {
          hasRefreshInFlightRef.current = true;
          startTransition(() => {
            router.refresh();
          });
        }
      } catch {
        // Polling is best effort. The next interval or user navigation will retry.
      } finally {
        isPollingRef.current = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void pollFreshness();
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [intervalMs, router]);

  return null;
}
