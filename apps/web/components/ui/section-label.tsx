import { cn } from "@/lib/utils";
import { TEXT } from "@/app/_lib/design-tokens";

type HeadingTag = "h2" | "h3" | "h4" | "p";

interface SectionLabelProps {
  readonly children: React.ReactNode;
  readonly as?: HeadingTag;
  readonly className?: string;
}

export function SectionLabel({
  children,
  as: Tag = "h3",
  className,
}: SectionLabelProps) {
  return <Tag className={cn(TEXT.label, className)}>{children}</Tag>;
}
