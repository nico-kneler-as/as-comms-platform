import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { AVATAR_TONE } from "@/app/_lib/design-tokens";

type ToneAvatarTone = keyof typeof AVATAR_TONE;

const SIZE_CLASSES = {
  sm: "size-8 text-xs",
  xs: "size-9 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-base",
} as const;

interface ToneAvatarProps {
  readonly initials: string;
  readonly tone: ToneAvatarTone;
  readonly size?: keyof typeof SIZE_CLASSES;
  readonly className?: string;
}

export function ToneAvatar({
  initials,
  tone,
  size = "md",
  className,
}: ToneAvatarProps) {
  return (
    <Avatar className={cn(SIZE_CLASSES[size], className)} aria-hidden="true">
      <AvatarFallback className={cn("font-semibold", AVATAR_TONE[tone])}>
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
