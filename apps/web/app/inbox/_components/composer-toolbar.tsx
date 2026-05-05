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
  QuoteIcon,
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
    </div>
  );
}
