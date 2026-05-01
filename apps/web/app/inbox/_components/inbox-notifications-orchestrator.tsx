"use client";

import { useEffect, useRef } from "react";

const BASE_TITLE = "AS Comms Platform";
const NOTIFICATION_TAG = "as-comms-inbox";

interface InboxNotificationsOrchestratorProps {
  readonly unreadCount: number;
}

export function getInboxDocumentTitle(
  unreadCount: number,
  visibilityState: DocumentVisibilityState,
): string {
  if (visibilityState !== "visible" && unreadCount > 0) {
    return `(${unreadCount.toString()}) ${BASE_TITLE}`;
  }

  return BASE_TITLE;
}

function syncDocumentTitle(unreadCount: number) {
  if (typeof document === "undefined") {
    return;
  }

  document.title = getInboxDocumentTitle(unreadCount, document.visibilityState);
}

function fireUnreadNotification(unreadDelta: number) {
  if (
    typeof window === "undefined" ||
    typeof Notification === "undefined" ||
    unreadDelta <= 0
  ) {
    return;
  }

  const notification = new Notification(
    `AS Comms — ${unreadDelta.toString()} new`,
    {
    body: "Open inbox to triage.",
    icon: "/icon",
    tag: NOTIFICATION_TAG,
    },
  );

  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

export function InboxNotificationsOrchestrator({
  unreadCount,
}: InboxNotificationsOrchestratorProps) {
  const previousUnreadCountRef = useRef<number | undefined>(undefined);
  const unreadCountRef = useRef(unreadCount);

  useEffect(() => {
    unreadCountRef.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    syncDocumentTitle(unreadCount);
  }, [unreadCount]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = () => {
      syncDocumentTitle(unreadCountRef.current);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof document === "undefined" ||
      typeof Notification === "undefined"
    ) {
      previousUnreadCountRef.current = unreadCount;
      return;
    }

    const previousUnreadCount = previousUnreadCountRef.current;
    previousUnreadCountRef.current = unreadCount;

    if (previousUnreadCount === undefined) {
      return;
    }

    const unreadDelta = unreadCount - previousUnreadCount;

    if (unreadDelta <= 0 || document.visibilityState === "visible") {
      return;
    }

    if (Notification.permission === "granted") {
      fireUnreadNotification(unreadDelta);
      return;
    }

    if (Notification.permission !== "default") {
      return;
    }

    let cancelled = false;

    void Notification.requestPermission()
      .then((permission) => {
        if (!cancelled && permission === "granted") {
          fireUnreadNotification(unreadDelta);
        }
      })
      .catch(() => {
        // Permission requests can fail silently in some browser states.
      });

    return () => {
      cancelled = true;
    };
  }, [unreadCount]);

  return null;
}
