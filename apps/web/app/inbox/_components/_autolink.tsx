import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g;

export function autolinkText(
  body: string,
  linkClassName: string,
): ReactNode {
  return body.split(URL_PATTERN).map((segment, index) => {
    if (index % 2 === 0) {
      return segment;
    }

    return (
      <a
        key={`${segment}-${String(index)}`}
        href={segment}
        target="_blank"
        rel="noopener noreferrer"
        className={cn("underline-offset-2 hover:underline", linkClassName)}
      >
        {segment}
      </a>
    );
  });
}
