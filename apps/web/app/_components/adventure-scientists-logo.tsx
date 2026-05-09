import { cn } from "@/lib/utils";
import { BRAND } from "@/app/_lib/design-tokens";

interface AdventureScientistsLogoProps {
  readonly className?: string;
}

const MASK_URL = "url(/brand/as-mark.png)";

export function AdventureScientistsLogo({
  className
}: AdventureScientistsLogoProps) {
  return (
    <span
      role="img"
      aria-label="Adventure Scientists"
      className={cn("inline-block", BRAND.bg, className)}
      style={{
        maskImage: MASK_URL,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskImage: MASK_URL,
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center"
      }}
    />
  );
}
