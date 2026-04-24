"use client";

import type { ReactNode } from "react";

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
  {
    command: "bold",
    label: "Bold",
    icon: <BoldIcon className="size-4" />,
  },
  {
    command: "italic",
    label: "Italic",
    icon: <ItalicIcon className="size-4" />,
  },
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
  {
    command: "link",
    label: "Link",
    icon: <LinkIcon className="size-4" />,
  },
];

export function ComposerToolbar({
  activeCommands,
  onCommand,
}: ComposerToolbarProps) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-sm">
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
              "inline-flex size-8 items-center justify-center rounded text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-300",
              active
                ? "bg-slate-900 text-white hover:bg-slate-800 hover:text-white"
                : "",
            )}
          >
            {item.icon}
          </button>
        );
      })}
    </div>
  );
}
