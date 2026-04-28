import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface FeedbackState {
  readonly kind: "success" | "error";
  readonly message: string;
}

interface SettingsSectionProps {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly feedback?: FeedbackState | null;
  readonly children: ReactNode;
}

/**
 * Shared section primitive for the single-page settings surface.
 *
 * Each section gets a heading + one-line description on the left and an
 * optional primary action on the right. The body slot renders the section's
 * card / list / grid.
 */
export function SettingsSection({
  id,
  title,
  description,
  action,
  feedback,
  children
}: SettingsSectionProps) {
  const headingId = `${id}-heading`;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h2
            id={headingId}
            className="text-lg font-semibold tracking-tight text-slate-950"
          >
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-sm text-slate-500">{description}</p>
          ) : null}
        </div>
        {action ? (
          <div className="flex shrink-0 items-center gap-2">{action}</div>
        ) : null}
      </header>

      {feedback ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            feedback.kind === "success"
              ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"
              : "bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200"
          )}
        >
          {feedback.message}
        </div>
      ) : null}

      <div>{children}</div>
    </section>
  );
}
