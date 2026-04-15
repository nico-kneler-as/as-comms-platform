"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { MailIcon, NoteIcon, PhoneIcon, SendIcon, SparkleIcon } from "./claude-icons";

type ComposerMode = "email" | "sms" | "note";

interface ComposerProps {
  readonly contactDisplayName: string;
  readonly smsEligible: boolean;
}

export function ClaudeInboxComposer({
  contactDisplayName,
  smsEligible
}: ComposerProps) {
  const [mode, setMode] = useState<ComposerMode>("email");
  const [draft, setDraft] = useState("");
  const [subject, setSubject] = useState("");

  const placeholder = placeholderForMode(mode, contactDisplayName);

  return (
    <div className="border-t border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-2.5">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value) setMode(value as ComposerMode);
          }}
          size="sm"
          className="gap-1 rounded-lg bg-slate-100 p-0.5"
        >
          <ToggleGroupItem
            value="email"
            className="gap-1.5 rounded-md px-2.5 text-xs data-[state=on]:bg-white data-[state=on]:text-slate-900 data-[state=on]:shadow-sm [&_svg]:size-3.5"
          >
            <MailIcon className="h-3.5 w-3.5" />
            Email
          </ToggleGroupItem>
          <ToggleGroupItem
            value="sms"
            disabled={!smsEligible}
            title={smsEligible ? undefined : "No verified phone"}
            className="gap-1.5 rounded-md px-2.5 text-xs data-[state=on]:bg-white data-[state=on]:text-slate-900 data-[state=on]:shadow-sm [&_svg]:size-3.5"
          >
            <PhoneIcon className="h-3.5 w-3.5" />
            SMS
          </ToggleGroupItem>
          <ToggleGroupItem
            value="note"
            className="gap-1.5 rounded-md px-2.5 text-xs data-[state=on]:bg-white data-[state=on]:text-slate-900 data-[state=on]:shadow-sm [&_svg]:size-3.5"
          >
            <NoteIcon className="h-3.5 w-3.5" />
            Internal note
          </ToggleGroupItem>
        </ToggleGroup>
        <Button variant="outline" size="sm" className="gap-1.5">
          <SparkleIcon className="h-3.5 w-3.5 text-violet-600" />
          Draft with AI
        </Button>
      </div>

      <div className={mode === "note" ? "bg-amber-50/50" : ""}>
        {mode === "email" ? (
          <>
            <div className="border-b border-slate-100 px-5 py-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">To:</span>{" "}
              <span>{contactDisplayName}</span>
            </div>
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-2 text-xs">
              <label
                htmlFor="claude-inbox-subject"
                className="font-medium text-slate-700"
              >
                Subject:
              </label>
              <input
                id="claude-inbox-subject"
                type="text"
                value={subject}
                onChange={(event) => {
                  const target = event.currentTarget as unknown as {
                    readonly value: string;
                  };
                  setSubject(target.value);
                }}
                placeholder="Add a subject"
                className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
            </div>
          </>
        ) : null}
        <textarea
          value={draft}
          onChange={(event) => {
            const target = event.currentTarget as unknown as {
              readonly value: string;
            };
            setDraft(target.value);
          }}
          placeholder={placeholder}
          rows={4}
          className="block w-full resize-none bg-transparent px-5 py-3 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus:outline-none"
        />
      </div>

      <div
        className={cn(
          "flex items-center border-t border-slate-100 px-5 py-3",
          mode === "note" ? "justify-between" : "justify-end"
        )}
      >
        {mode === "note" ? (
          <p className="text-[11px] text-slate-500">
            Internal notes are visible only to operators.
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm">
            Save draft
          </Button>
          <Button size="sm" className="gap-1.5">
            <SendIcon className="h-3.5 w-3.5" />
            {mode === "note" ? "Save note" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function placeholderForMode(mode: ComposerMode, name: string): string {
  switch (mode) {
    case "email":
      return `Reply to ${name}…`;
    case "sms":
      return `Text ${name}…`;
    case "note":
      return "Write a note for the team — not visible to the contact.";
  }
}
