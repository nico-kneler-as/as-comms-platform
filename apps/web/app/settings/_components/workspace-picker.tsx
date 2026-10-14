"use client";

import { TYPE } from "@/app/_lib/design-tokens-v2";
import { cn } from "@/lib/utils";

export type WorkspaceOptionValue = "volunteers" | "donors";

export const WORKSPACE_OPTIONS = [
  {
    value: "volunteers",
    label: "Volunteers",
    description: "Inbox, volunteer and newsletter broadcasts.",
  },
  {
    value: "donors",
    label: "Donors",
    description: "Donor appeals.",
  },
] as const satisfies readonly {
  readonly value: WorkspaceOptionValue;
  readonly label: string;
  readonly description: string;
}[];

export function workspaceLabel(value: WorkspaceOptionValue): string {
  return value === "donors" ? "Donors" : "Volunteers";
}

/**
 * Checkbox group for a teammate's spaces. At least one stays selected: the
 * last checked box cannot be cleared.
 */
export function WorkspacePicker({
  value,
  onChange,
  disabled,
  label = "Spaces",
}: {
  readonly value: readonly WorkspaceOptionValue[];
  readonly onChange: (next: WorkspaceOptionValue[]) => void;
  readonly disabled?: boolean;
  readonly label?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className={TYPE.label}>{label}</p>
      <div role="group" aria-label={label} className="flex flex-col gap-2">
        {WORKSPACE_OPTIONS.map((option) => {
          const checked = value.includes(option.value);
          const isLastChecked = checked && value.length === 1;
          return (
            <button
              key={option.value}
              type="button"
              role="checkbox"
              aria-checked={checked}
              disabled={disabled === true || isLastChecked}
              onClick={() => {
                onChange(
                  checked
                    ? value.filter((entry) => entry !== option.value)
                    : WORKSPACE_OPTIONS.map((entry) => entry.value).filter(
                        (entry) => entry === option.value || value.includes(entry),
                      ),
                );
              }}
              className={cn(
                "flex items-start gap-3 rounded-lg border bg-white p-3 text-left text-sm",
                "transition-colors duration-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1",
                "disabled:cursor-not-allowed disabled:opacity-60",
                checked
                  ? "border-slate-900 ring-1 ring-slate-900"
                  : "border-slate-200 hover:border-slate-300",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                  checked ? "border-slate-900 bg-[#253746]" : "border-slate-300",
                )}
              >
                {checked ? (
                  <span className="text-[10px] font-bold leading-none text-white">
                    ✓
                  </span>
                ) : null}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-slate-900">
                  {option.label}
                </span>
                <span className={cn("mt-0.5 block", TYPE.caption)}>
                  {option.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
