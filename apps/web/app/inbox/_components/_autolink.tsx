import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g;
const TRAILING_PUNCTUATION_PATTERN = /[.,!?;:)]/;

function splitTrailingPunctuation(segment: string): {
  readonly href: string;
  readonly trailingText: string;
} {
  let href = segment;
  let trailingText = "";

  while (href.length > 0) {
    const trailingCharacter = href.at(-1);

    if (
      trailingCharacter === undefined ||
      !TRAILING_PUNCTUATION_PATTERN.test(trailingCharacter)
    ) {
      break;
    }

    if (trailingCharacter === ")") {
      const openParentheses = href.match(/\(/g)?.length ?? 0;
      const closeParentheses = href.match(/\)/g)?.length ?? 0;

      if (closeParentheses <= openParentheses) {
        break;
      }
    }

    trailingText = `${trailingCharacter}${trailingText}`;
    href = href.slice(0, -1);
  }

  return {
    href,
    trailingText,
  };
}

export function autolinkText(
  body: string,
  linkClassName: string,
): ReactNode {
  return body.split(URL_PATTERN).map((segment, index) => {
    if (index % 2 === 0) {
      return segment;
    }

    const { href, trailingText } = splitTrailingPunctuation(segment);

    if (href.length === 0) {
      return segment;
    }

    return (
      <Fragment key={`${segment}-${String(index)}`}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "font-medium underline decoration-current/70 underline-offset-2 transition-[text-decoration-color] hover:decoration-current focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 [overflow-wrap:anywhere]",
            linkClassName,
          )}
        >
          {href}
        </a>
        {trailingText}
      </Fragment>
    );
  });
}
