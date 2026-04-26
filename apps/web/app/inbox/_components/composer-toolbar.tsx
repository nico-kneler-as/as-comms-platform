"use client";

import type { ReactNode } from "react";

import { FOCUS_RING, TRANSITION } from "@/app/_lib/design-tokens-v2";
import { cn } from "@/lib/utils";

import {
  BoldIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
} from "./icons";

export type ComposerToolbarCommand =
  | "bold"
  | "italic"
  | "bulletList"
  | "orderedList"
  | "link";

interface ComposerToolbarProps {
  readonly activeCommands: ReadonlySet<ComposerToolbarCommand>;
  readonly onCommand: (command: ComposerToolbarCommand) => void;
}

const TOOLBAR_ITEMS: readonly {
  readonly command: ComposerToolbarCommand;
  readonly label: string;
  readonly icon: ReactNode;
}[] = [
  { command: "bold", label: "Bold", icon: <BoldIcon className="size-4" /> },
  { command: "italic", label: "Italic", icon: <ItalicIcon className="size-4" /> },
  {
    command: "bulletList",
    label: "Bulleted list",
    icon: <ListIcon className="size-4" />,
  },
  {
    command: "orderedList",
    label: "Numbered list",
    icon: <ListOrderedIcon className="size-4" />,
  },
  { command: "link", label: "Link", icon: <LinkIcon className="size-4" /> },
];

export function ComposerToolbar({
  activeCommands,
  onCommand,
}: ComposerToolbarProps) {
  return (
    <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-4 py-2">
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
            {item.icon}
          </button>
        );
      })}
    </div>
  );
}
