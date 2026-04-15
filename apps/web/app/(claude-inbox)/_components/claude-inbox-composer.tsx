"use client";

import { useState } from "react";

import { MailIcon, NoteIcon, PhoneIcon, SendIcon, SparkleIcon } from "./claude-icons";

type ComposerMode = "email" | "sms" | "note";

interface ComposerProps {
  readonly contactDisplayName: string;
  readonly smsEligible: boolean;
}

/**
 * Client island: owns only local draft state and the current compose mode.
 * It never holds canonical inbox state. In Phase 3 the Send / Draft actions
 * will invoke Server Actions that return the safe UiResult envelope and
 * revalidate tags like `inbox:contact:{contactId}` and
 * `timeline:contact:{contactId}`.
 */
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
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
          <ModeTab
            active={mode === "email"}
            onClick={() => {
              setMode("email");
            }}
            icon={<MailIcon className="h-3.5 w-3.5" />}
            label="Email"
          />
          <ModeTab
            active={mode === "sms"}
            onClick={() => {
              setMode("sms");
            }}
            icon={<PhoneIcon className="h-3.5 w-3.5" />}
            label="SMS"
            disabled={!smsEligible}
            {...(smsEligible ? {} : { disabledHint: "No verified phone" })}
          />
          <ModeTab
            active={mode === "note"}
            onClick={() => {
              setMode("note");
            }}
            icon={<NoteIcon className="h-3.5 w-3.5" />}
            label="Internal note"
          />
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 motion-reduce:transition-none"
        >
          <SparkleIcon className="h-3.5 w-3.5 text-violet-600" />
          Draft with AI
        </button>
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
                  // tsconfig omits the DOM lib so the ambient element stub
                  // exposes no `value` field; narrow through unknown.
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
            // Project tsconfig omits the DOM lib, so the ambient
            // HTMLTextAreaElement stub exposes no `value` field. We narrow
            // through `unknown` rather than pulling in DOM types.
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
        className={`flex items-center border-t border-slate-100 px-5 py-3 ${
          mode === "note" ? "justify-between" : "justify-end"
        }`}
      >
        {mode === "note" ? (
          <p className="text-[11px] text-slate-500">
            Internal notes are visible only to operators.
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 motion-reduce:transition-none"
          >
            Save draft
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors duration-150 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 motion-reduce:transition-none"
          >
            <SendIcon className="h-3.5 w-3.5" />
            {mode === "note" ? "Save note" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ModeTabProps {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly disabled?: boolean;
  readonly disabledHint?: string;
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
  disabled,
  disabledHint
}: ModeTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition ${
        active
          ? "bg-white text-slate-900 shadow-sm"
          : disabled
            ? "text-slate-300"
            : "text-slate-500 hover:text-slate-900"
      }`}
    >
      {icon}
      {label}
    </button>
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
