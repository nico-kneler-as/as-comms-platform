import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { AVATAR_TONE } from "@/app/_lib/design-tokens";

type ToneAvatarTone = keyof typeof AVATAR_TONE;

const SIZE_CLASSES = {
  sm: "h-8 w-8 text-xs",
  xs: "h-9 w-9 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
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
    <Avatar
      className={cn(size === "xs" ? "" : "ring-1", SIZE_CLASSES[size], className)}
      aria-hidden="true"
    >
      <AvatarFallback className={cn("font-semibold", AVATAR_TONE[tone])}>
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
