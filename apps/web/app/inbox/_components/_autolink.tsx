import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const URL_PATTERN = /https?:\/\/[^\s<>"]+/gu;
const MARKDOWN_LINK_PATTERN = /\[([^\]\n]+)\]\((https?:\/\/[^\s<>)"]+)\)/gu;
const PARENTHETICAL_LINK_PATTERN =
  /(^|[\n.!?]\s+)([^\n()[\]]{1,80}?)\s+\((https?:\/\/[^\s<>)"]+)\)/gu;
const TRAILING_PUNCTUATION_PATTERN = /[.,!?;:)]/;
const LINK_CLASS_NAME =
  "text-sky-700 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 [overflow-wrap:anywhere]";

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
  linkClassName?: string,
): ReactNode {
  return renderLinks(body, linkClassName);
}

function renderLinks(body: string, linkClassName?: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  const richLinkPattern = new RegExp(
    `${MARKDOWN_LINK_PATTERN.source}|${PARENTHETICAL_LINK_PATTERN.source}`,
    "gu",
  );

  for (const match of body.matchAll(richLinkPattern)) {
    const rawMatch = match[0];
    const matchIndex = match.index;
    const markdownLabel = match[1];
    const markdownHref = match[2];
    const boundary = match[3] ?? "";
    const parentheticalLabel = match[4];
    const parentheticalHref = match[5];
    const label = markdownLabel ?? parentheticalLabel;
    const href = markdownHref ?? parentheticalHref;

    if (label === undefined || href === undefined) {
      continue;
    }

    const linkStart = matchIndex + boundary.length;
    nodes.push(
      ...renderBareUrls(
        body.slice(cursor, linkStart),
        `plain-${String(index)}`,
        linkClassName,
      ),
    );
    nodes.push(renderLink(href, label.trim(), `rich-${String(index)}`, linkClassName));
    cursor = matchIndex + rawMatch.length;
    index += 1;
  }

  nodes.push(
    ...renderBareUrls(body.slice(cursor), `plain-${String(index)}`, linkClassName),
  );

  return nodes;
}

function renderBareUrls(
  segment: string,
  keyPrefix: string,
  linkClassName?: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;

  for (const match of segment.matchAll(URL_PATTERN)) {
    const rawUrl = match[0];
    const matchIndex = match.index;
    const { href, trailingText } = splitTrailingPunctuation(rawUrl);

    nodes.push(segment.slice(cursor, matchIndex));

    if (href.length === 0) {
      nodes.push(rawUrl);
    } else {
      nodes.push(renderLink(href, href, `${keyPrefix}-${String(index)}`, linkClassName));
      nodes.push(trailingText);
    }

    cursor = matchIndex + rawUrl.length;
    index += 1;
  }

  nodes.push(segment.slice(cursor));
  return nodes;
}

function renderLink(
  href: string,
  label: string,
  key: string,
  linkClassName?: string,
): ReactNode {
  return (
    <Fragment key={key}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(linkClassName, LINK_CLASS_NAME)}
      >
        {label}
      </a>
    </Fragment>
  );
}
