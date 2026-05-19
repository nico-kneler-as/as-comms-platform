"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { cancel } from "../../actions";

export function CancelModal({
  open,
  onOpenChange,
  runId,
  sentCount,
  totalAudience,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly runId: string;
  readonly sentCount: number | null;
  readonly totalAudience: number | null;
}) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this broadcast?</DialogTitle>
          <DialogDescription className="space-y-3 pt-2 text-sm leading-6 text-slate-600">
            <span className="block">
              We&apos;ll stop sending to remaining recipients.{" "}
              <strong>Already-sent emails cannot be recalled.</strong>{" "}
              {sentCount === null || totalAudience === null
                ? "The current sent count is still loading."
                : `${sentCount.toLocaleString()} of ${totalAudience.toLocaleString()} emails have been sent so far.`}
            </span>
            {errorMessage ? (
              <span className="block rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                {errorMessage}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Keep sending
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const result = await cancel(
                  runId,
                  "operator_cancelled_from_run_detail",
                );
                if (!result.ok) {
                  setErrorMessage(result.message);
                  return;
                }

                setErrorMessage(null);
                onOpenChange(false);
                router.refresh();
              });
            }}
          >
            {pending ? "Cancelling…" : "Cancel broadcast"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
