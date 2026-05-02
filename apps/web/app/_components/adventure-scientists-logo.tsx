import Image from "next/image";

import { cn } from "@/lib/utils";

interface AdventureScientistsLogoProps {
  readonly className?: string;
}

export function AdventureScientistsLogo({
  className
}: AdventureScientistsLogoProps) {
  return (
    <Image
      src="/brand/as-mark.png"
      alt=""
      width={64}
      height={64}
      priority
      className={cn("object-contain", className)}
      aria-hidden="true"
    />
  );
}
