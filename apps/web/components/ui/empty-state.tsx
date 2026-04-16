import { cn } from "@/lib/utils";
import { RADIUS, TEXT } from "@/app/_lib/design-tokens";

interface EmptyStateProps {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly description: React.ReactNode;
  /** `sm` for inline/list contexts, `lg` for full-page empty states */
  readonly size?: "sm" | "lg";
  readonly className?: string;
}

const SIZE_CONFIG = {
  sm: {
    wrapper: "px-5 py-16 text-center",
    iconBox: "mx-auto flex h-12 w-12 items-center justify-center",
    iconClass: "h-6 w-6 text-slate-400",
    title: "mt-4 text-sm font-medium text-slate-700",
    description: `mt-1 ${TEXT.caption}`,
  },
  lg: {
    wrapper: "flex h-full flex-col items-center justify-center px-10 text-center",
    iconBox: "flex h-14 w-14 items-center justify-center",
    iconClass: "h-7 w-7",
    title: "mt-5 text-base font-semibold text-slate-900",
    description: "mt-1 max-w-sm text-sm leading-6 text-slate-500",
  },
} as const;

export function EmptyState({
  icon,
  title,
  description,
  size = "sm",
  className,
}: EmptyStateProps) {
  const cfg = SIZE_CONFIG[size];

  return (
    <div className={cn(cfg.wrapper, className)}>
      <div className={cn(cfg.iconBox, RADIUS.bubble, "bg-slate-100 text-slate-500")}>
        {icon}
      </div>
      <p className={cfg.title}>{title}</p>
      <p className={cfg.description}>{description}</p>
    </div>
  );
}
