"use client";

import { useEffect } from "react";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ErrorProps {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}

/**
 * Safe error boundary for the inbox route segment (FP-07).
 *
 * Renders inside the inbox layout shell so the icon rail and list column
 * stay visible. Never exposes raw error messages, stack traces, or
 * provider details — only the server-generated digest is logged.
 */
export default function InboxError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log only the digest (server-side hash), not the raw error object.
    // Raw errors could contain PII or provider details per FP-07.
    if (error.digest) {
      console.error("Inbox error digest:", error.digest);
    }
  }, [error.digest]);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-500">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h2 className="text-base font-semibold text-slate-900">
          Something went wrong
        </h2>
        <p className="max-w-sm text-sm text-slate-500">
          We couldn&apos;t load the inbox. This may be a temporary issue.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
