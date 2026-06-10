"use client";

import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StepHeaderProps {
  readonly title: string;
  readonly description?: string;
  readonly rightSlot?: ReactNode;
}

export function StepHeader({
  title,
  description,
  rightSlot,
}: StepHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4 pb-5">
      <div className="min-w-0">
        <h2 className="text-balance text-xl font-semibold tracking-tight text-slate-900">
          {title}
        </h2>
        {description ? (
          <p className="mt-2 max-w-2xl text-pretty text-[13px] leading-relaxed text-slate-500">
            {description}
          </p>
        ) : null}
      </div>
      {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
    </header>
  );
}

interface WizardFooterProps {
  readonly onBack?: () => void;
  readonly backDisabled?: boolean;
  readonly primaryLabel: string;
  readonly primaryAction?: () => void;
  readonly primaryDisabled?: boolean;
  readonly primaryLoading?: boolean;
  readonly primaryIcon?: ReactNode;
  readonly leftSlot?: ReactNode;
  readonly showPrimary?: boolean;
}

export function WizardFooter({
  onBack,
  backDisabled = false,
  primaryLabel,
  primaryAction,
  primaryDisabled = false,
  primaryLoading = false,
  primaryIcon,
  leftSlot,
  showPrimary = true,
}: WizardFooterProps) {
  return (
    <footer className="mt-auto flex items-center justify-between gap-3 border-t border-slate-200 pt-5">
      <div className="flex items-center gap-3">
        {onBack ? (
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            disabled={backDisabled}
            className="gap-1.5"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back
          </Button>
        ) : null}
        {leftSlot}
      </div>
      {showPrimary && primaryAction ? (
        <Button
          type="button"
          onClick={() => {
            if (!primaryDisabled && !primaryLoading) {
              primaryAction();
            }
          }}
          aria-disabled={primaryDisabled || primaryLoading}
          disabled={primaryDisabled || primaryLoading}
          className="gap-1.5 active:scale-[0.98] active:transition-transform motion-reduce:active:scale-100"
        >
          {primaryLabel}
          {primaryIcon}
        </Button>
      ) : null}
    </footer>
  );
}

interface SectionPanelProps {
  readonly label: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
}

export function SectionPanel({
  label,
  children,
  action,
  className,
  bodyClassName,
}: SectionPanelProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-slate-200 bg-white",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </h3>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
