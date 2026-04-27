"use client";

import { useEffect, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { ComposerFloatingPill } from "./composer-floating-pill";
import { useInboxClient } from "./inbox-client-provider";
import { InboxComposerDetailPane } from "./inbox-composer";
import { XIcon } from "./icons";

export function InboxWorkspace({ children }: { readonly children: ReactNode }) {
  const { composerPane, toast, clearToast } = useInboxClient();

  useEffect(() => {
    if (toast === null) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      clearToast();
    }, 3200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [clearToast, toast]);

  return (
    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      {children}
      {composerPane.mode === "closed" ? null : <InboxComposerDetailPane />}
      <ComposerFloatingPill />

      {toast ? (
        <div className="pointer-events-none absolute right-5 top-5 z-50 flex justify-end">
          <div
            role={toast.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex min-w-80 max-w-sm items-start gap-3 rounded-lg border px-4 py-3 shadow-lg ${
              toast.tone === "error"
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            <p className="flex-1 text-sm font-medium">{toast.message}</p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Dismiss notification"
              className="size-7 text-current hover:bg-black/5"
              onClick={clearToast}
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
