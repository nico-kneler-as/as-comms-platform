"use client";

import type { AutomatedEmailKind } from "@as-comms/contracts";

import {
  AUTOMATED_EMAIL_KIND_DEFINITIONS,
  AUTOMATED_EMAIL_PHASES,
} from "@/src/lib/automated-email-kinds";
import { cn } from "@/lib/utils";

export function AutomatedEmailKindsChecklist({
  selectedKinds,
  onSelectedKindsChange,
  includeCustom,
  onIncludeCustomChange,
  sourceProjectByKind,
  idPrefix = "automated-email-kind",
}: {
  readonly selectedKinds: readonly Exclude<AutomatedEmailKind, "custom">[];
  readonly onSelectedKindsChange: (
    kinds: readonly Exclude<AutomatedEmailKind, "custom">[],
  ) => void;
  readonly includeCustom: boolean;
  readonly onIncludeCustomChange: (includeCustom: boolean) => void;
  readonly sourceProjectByKind: Readonly<
    Partial<Record<Exclude<AutomatedEmailKind, "custom">, string | null>>
  >;
  readonly idPrefix?: string;
}) {
  const selected = new Set(selectedKinds);
  const shellCount = selectedKinds.length + (includeCustom ? 1 : 0);

  function toggle(kind: Exclude<AutomatedEmailKind, "custom">) {
    onSelectedKindsChange(
      selected.has(kind)
        ? selectedKinds.filter((item) => item !== kind)
        : [...selectedKinds, kind],
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] leading-relaxed text-slate-700">
        Pick what this project actually sends. Every kind you check creates an{" "}
        <span className="font-medium text-slate-900">inactive shell</span> —
        nothing goes out until you publish the copy and switch it on. Skip
        anything you don&apos;t need; you can add kinds any time.
      </p>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {AUTOMATED_EMAIL_PHASES.map((phase) => {
          const phaseKinds = AUTOMATED_EMAIL_KIND_DEFINITIONS.filter(
            (definition) => definition.phase === phase,
          );

          return (
            <div key={phase}>
              <div className="border-b border-slate-200/80 bg-slate-50/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {phase}
              </div>
              {phaseKinds.map((definition) => {
                const checked = selected.has(definition.kind);
                const index =
                  AUTOMATED_EMAIL_KIND_DEFINITIONS.indexOf(definition);
                const source = sourceProjectByKind[definition.kind] ?? null;
                const inputId = `${idPrefix}-${definition.kind}`;

                return (
                  <label
                    key={definition.kind}
                    htmlFor={inputId}
                    className={cn(
                      "relative flex cursor-pointer items-center gap-3 border-b border-slate-200/70 px-3 py-2 transition-colors last:border-b-0",
                      checked ? "bg-sky-50/40" : "hover:bg-slate-50/70",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="absolute left-[22px] top-0 h-full w-px bg-slate-200"
                    />
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        toggle(definition.kind);
                      }}
                      className="relative z-10 size-4 shrink-0 rounded border-slate-300 bg-white text-slate-900 focus:ring-slate-400"
                    />
                    <span className="relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold tabular-nums text-slate-500 ring-2 ring-white">
                      {String(index + 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-slate-900">
                        {definition.label}
                      </span>
                      <span className="block truncate text-[11.5px] text-slate-500">
                        {definition.blurb}
                      </span>
                    </span>
                    {source === null ? (
                      <span className="shrink-0 text-[11px] text-slate-400">
                        starts blank
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] text-slate-500">
                        starting from:{" "}
                        <span className="font-medium text-slate-700">
                          {source}
                        </span>
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>

      <label
        htmlFor={`${idPrefix}-custom`}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 transition-colors",
          includeCustom
            ? "border-slate-400 bg-slate-50"
            : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/70",
        )}
      >
        <input
          id={`${idPrefix}-custom`}
          type="checkbox"
          checked={includeCustom}
          onChange={(event) => {
            onIncludeCustomChange(event.target.checked);
          }}
          className="size-4 shrink-0 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium text-slate-900">
            Custom…
          </span>
          <span className="block text-[11.5px] text-slate-500">
            A blank template for a moment that isn&apos;t on this list.
          </span>
        </span>
      </label>

      <div className="flex items-center justify-between rounded-md bg-slate-100/80 px-3 py-2 text-[11.5px] text-slate-500">
        <span>
          {shellCount === 0
            ? "Nothing selected — that's a fine place to start."
            : `${String(shellCount)} shell${shellCount === 1 ? "" : "s"} will be created, all inactive.`}
        </span>
        <span className="text-slate-400">
          {String(
            AUTOMATED_EMAIL_KIND_DEFINITIONS.length - selectedKinds.length,
          )}{" "}
          skipped
        </span>
      </div>
    </div>
  );
}
