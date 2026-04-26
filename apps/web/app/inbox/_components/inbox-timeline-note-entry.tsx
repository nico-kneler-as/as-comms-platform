"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { deleteNoteAction, updateNoteAction } from "../actions";
import type { InboxTimelineEntryViewModel } from "../_lib/view-models";
import { getInternalNoteValidationError } from "@/src/lib/internal-note-validation";
import { LoaderIcon, NoteIcon } from "./icons";

const WRAP_ANYWHERE = "break-words [overflow-wrap:anywhere]";

const EXACT_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

function formatExactTimestamp(timestamp: string): string {
  return EXACT_TIMESTAMP_FORMATTER.format(new Date(timestamp));
}

export function TimelineNoteEntry({
  entry,
  currentOperatorUserId,
}: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly currentOperatorUserId: string;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draftBody, setDraftBody] = useState(entry.body);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isSaving, startSaveTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const canManageNote =
    entry.noteId !== null &&
    entry.noteId !== undefined &&
    entry.authorId === currentOperatorUserId;

  const saveEdit = () => {
    const noteId = entry.noteId;

    if (
      typeof noteId !== "string" ||
      entry.authorId !== currentOperatorUserId
    ) {
      return;
    }

    const validationError = getInternalNoteValidationError(draftBody);

    if (validationError !== null) {
      setInlineError(validationError);
      return;
    }

    setInlineError(null);
    startSaveTransition(async () => {
      const result = await updateNoteAction({
        noteId,
        body: draftBody,
      });

      if (!result.ok) {
        setInlineError(result.message);
        return;
      }

      setIsEditing(false);
      router.refresh();
    });
  };

  const deleteNote = () => {
    const noteId = entry.noteId;

    if (
      typeof noteId !== "string" ||
      entry.authorId !== currentOperatorUserId
    ) {
      return;
    }

    setInlineError(null);
    startDeleteTransition(async () => {
      const result = await deleteNoteAction({
        noteId,
      });

      if (!result.ok) {
        setInlineError(result.message);
        return;
      }

      setDeleteOpen(false);
      router.refresh();
    });
  };

  return (
    <li className="flex w-full flex-col items-end pl-16">
      <div className="w-full max-w-[640px] rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 shadow-sm">
        <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-amber-700">
          <div className="flex items-center gap-1.5">
            <NoteIcon className="h-3 w-3" />
            <span className="font-medium">Note</span>
            <span className="text-amber-300">·</span>
            <span>{entry.actorLabel}</span>
            <span className="text-amber-300">·</span>
            <time dateTime={entry.occurredAt} title={formatExactTimestamp(entry.occurredAt)}>
              {entry.occurredAtLabel}
            </time>
          </div>
          {canManageNote ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-100"
                onClick={() => {
                  setDraftBody(entry.body);
                  setInlineError(null);
                  setIsEditing(true);
                }}
              >
                Edit
              </Button>
              <Popover open={deleteOpen} onOpenChange={setDeleteOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-100"
                  >
                    Delete
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 space-y-3" align="end">
                  <p className="text-sm font-medium text-slate-900">
                    Delete this note?
                  </p>
                  <p className="text-xs text-slate-500">
                    This removes the note from the shared timeline.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDeleteOpen(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={isDeleting}
                      onClick={deleteNote}
                    >
                      {isDeleting ? (
                        <>
                          <LoaderIcon className="size-3 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        "Delete"
                      )}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          ) : null}
        </div>
        {isEditing ? (
          <div className="space-y-3">
            <textarea
              rows={4}
              value={draftBody}
              onChange={(event) => {
                setDraftBody(event.currentTarget.value);
                if (inlineError !== null) {
                  setInlineError(null);
                }
              }}
              className="w-full resize-y rounded-md border border-amber-200 bg-white px-3 py-2 text-[13px] leading-relaxed text-slate-900 shadow-sm focus:outline-none focus:ring-1 focus:ring-amber-300"
            />
            {inlineError ? (
              <p className="text-xs text-rose-700">{inlineError}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraftBody(entry.body);
                  setInlineError(null);
                  setIsEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isSaving}
                onClick={saveEdit}
              >
                {isSaving ? (
                  <>
                    <LoaderIcon className="size-3 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p
              className={cn(
                "font-message-body whitespace-pre-wrap text-pretty text-[13.5px] leading-relaxed text-amber-900",
                WRAP_ANYWHERE,
              )}
            >
              {entry.body}
            </p>
            {inlineError ? (
              <p className="mt-2 text-xs text-rose-700">{inlineError}</p>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}
