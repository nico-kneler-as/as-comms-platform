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

import { deleteDraft } from "../../actions";

export function DeleteDraftButton({
  runId,
}: {
  readonly runId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setErrorMessage(null);
    }
    setOpen(nextOpen);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        disabled={pending}
        className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
        onClick={() => {
          handleOpenChange(true);
        }}
      >
        Delete draft
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this draft?</DialogTitle>
            <DialogDescription className="space-y-3 pt-2 text-sm leading-6 text-slate-600">
              <span className="block">
                This permanently removes the draft. This can&apos;t be undone.
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
                handleOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await deleteDraft(runId);
                  if (!result.ok) {
                    setErrorMessage(result.message);
                    return;
                  }

                  setErrorMessage(null);
                  handleOpenChange(false);
                  router.push("/broadcasts");
                });
              }}
            >
              {pending ? "Deleting…" : "Delete draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
