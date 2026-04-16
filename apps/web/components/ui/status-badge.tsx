import { cn } from "@/lib/utils";
import { TEXT } from "@/app/_lib/design-tokens";

interface StatusBadgeProps {
  readonly label: string;
  readonly colorClasses: string;
  /**
   * - `filled`: solid background, no ring (e.g. bucket "new")
   * - `soft`: light bg + ring-1 inset (e.g. volunteer stage badges)
   * - `subtle`: light bg, no ring, compact (e.g. project status inline)
   */
  readonly variant?: "filled" | "soft" | "subtle";
  readonly className?: string;
}

const VARIANT_CLASSES = {
  filled: `rounded-full px-2 py-0.5 ${TEXT.badge}`,
  soft: "rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
  subtle: "inline-flex items-center rounded px-1.5 py-px text-[10px] font-medium",
} as const;

export function StatusBadge({
  label,
  colorClasses,
  variant = "filled",
  className,
}: StatusBadgeProps) {
  return (
    <span className={cn(VARIANT_CLASSES[variant], colorClasses, className)}>
      {label}
    </span>
  );
}
