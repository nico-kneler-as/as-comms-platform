import { cn } from "@/lib/utils";
import { TEXT } from "@/app/_lib/design-tokens";

interface DividerLabelProps {
  readonly children: React.ReactNode;
  readonly className?: string;
}

export function DividerLabel({ children, className }: DividerLabelProps) {
  return (
    <div className={cn("flex w-full items-center gap-3 py-1", className)}>
      <div className="h-px flex-1 bg-slate-200" />
      <span className={`shrink-0 ${TEXT.micro}`}>{children}</span>
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}
