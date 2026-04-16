import { cn } from "@/lib/utils";
import { CHIP_TONE } from "@/app/_lib/design-tokens";

type ChipTone = keyof typeof CHIP_TONE;

interface ChipProps {
  readonly tone?: ChipTone;
  readonly children: React.ReactNode;
  readonly icon?: React.ReactNode;
  readonly className?: string;
}

export function Chip({
  tone = "neutral",
  children,
  icon,
  className,
}: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5 ring-1 ring-inset",
        CHIP_TONE[tone],
        className,
      )}
    >
      {icon ? <span className="flex h-3 w-3 items-center">{icon}</span> : null}
      {children}
    </span>
  );
}
