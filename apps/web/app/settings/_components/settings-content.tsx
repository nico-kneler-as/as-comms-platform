import type { ReactNode } from "react";

import { LAYOUT, TEXT } from "@/app/_lib/design-tokens";
import { cn } from "@/lib/utils";

interface SettingsContentProps {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Column 3 shell. Matches the inbox detail column: fixed header height,
 * sticky border, then scrollable content beneath. Every section-level page
 * renders through this so header spacing stays consistent.
 */
export function SettingsContent({
  title,
  description,
  action,
  children
}: SettingsContentProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header
        className={cn(
          "flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6",
          LAYOUT.headerHeight
        )}
      >
        <div className="min-w-0">
          <h1 className={TEXT.headingSm}>{title}</h1>
          {description ? (
            <p className={cn(TEXT.caption, "mt-0.5 truncate")}>
              {description}
            </p>
          ) : null}
        </div>
        {action ? (
          <div className="flex shrink-0 items-center gap-2">{action}</div>
        ) : null}
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
    </div>
  );
}
