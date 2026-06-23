"use client";

import type { ComponentType } from "react";

import { FOCUS_RING, TRANSITION } from "@/app/_lib/design-tokens-v2";
import { cn } from "@/lib/utils";

import {
  BoldIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  LoaderIcon,
  QuoteIcon,
  SparklesIcon,
} from "./icons";

export type ComposerToolbarCommand =
  | "bold"
  | "italic"
  | "bulletList"
  | "orderedList"
  | "link"
  | "blockquote";

interface ComposerToolbarProps {
  readonly activeCommands: ReadonlySet<ComposerToolbarCommand>;
  readonly onCommand: (command: ComposerToolbarCommand) => void;
  readonly polishPhase?: "idle" | "busy" | "done";
  readonly polishDisabled?: boolean;
  readonly onRunPolish?: () => void;
}

function PolishToolbarButton({
  phase,
  disabled,
  onRun,
}: {
  readonly phase: "idle" | "busy" | "done";
  readonly disabled: boolean;
  readonly onRun: () => void;
}) {
  const busy = phase === "busy";

  return (
    <button
      type="button"
      onClick={onRun}
      disabled={disabled}
      title="Polish — rewrite the whole message in clearer language"
      className={cn(
        "group/polish flex h-7 items-center justify-center rounded px-1.5 transition-colors disabled:cursor-default disabled:opacity-60",
        busy
          ? "bg-violet-100 text-violet-700"
          : "text-violet-600 hover:bg-violet-100",
      )}
    >
      {busy ? (
        <LoaderIcon className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : (
        <SparklesIcon className="h-3.5 w-3.5 shrink-0" />
      )}
      <span
        className={cn(
          "overflow-hidden whitespace-nowrap text-[11.5px] font-medium transition-all duration-200 ease-out",
          busy
            ? "ml-1.5 max-w-[88px] opacity-100"
            : "ml-0 max-w-0 opacity-0 group-hover/polish:ml-1.5 group-hover/polish:max-w-[88px] group-hover/polish:opacity-100",
        )}
      >
        {busy ? "Polishing..." : "Polish"}
      </span>
    </button>
  );
}

const TOOLBAR_ITEMS: readonly {
  readonly command: ComposerToolbarCommand;
  readonly label: string;
  readonly Icon: ComponentType<{ className?: string }>;
}[] = [
  { command: "bold", label: "Bold", Icon: BoldIcon },
  { command: "italic", label: "Italic", Icon: ItalicIcon },
  { command: "bulletList", label: "Bulleted list", Icon: ListIcon },
  { command: "orderedList", label: "Numbered list", Icon: ListOrderedIcon },
  { command: "link", label: "Link", Icon: LinkIcon },
  { command: "blockquote", label: "Quote", Icon: QuoteIcon },
];

export function ComposerToolbar({
  activeCommands,
  onCommand,
  polishPhase = "idle",
  polishDisabled = true,
  onRunPolish,
}: ComposerToolbarProps) {
  return (
    <div className="flex items-center gap-0.5 border-b border-slate-100 bg-white px-3 py-1.5">
      {TOOLBAR_ITEMS.map((item) => {
        const active = activeCommands.has(item.command);

        return (
          <button
            key={item.command}
            type="button"
            aria-label={item.label}
            aria-pressed={active}
            title={item.label}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              onCommand(item.command);
            }}
            className={cn(
              `inline-flex size-8 items-center justify-center rounded text-slate-600 ${TRANSITION.fast} ${FOCUS_RING} ${TRANSITION.reduceMotion} hover:bg-slate-100 hover:text-slate-900`,
              active ? "bg-slate-200 text-slate-900" : "",
            )}
          >
            <item.Icon className="size-4" />
          </button>
        );
      })}
      {onRunPolish ? (
        <>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <PolishToolbarButton
            phase={polishPhase}
            disabled={polishDisabled}
            onRun={onRunPolish}
          />
        </>
      ) : null}
    </div>
  );
}
