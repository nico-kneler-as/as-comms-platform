import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const URL_PATTERN = /https?:\/\/[^\s<>"]+/gu;
const MARKDOWN_LINK_PATTERN = /\[([^\]\n]+)\]\((https?:\/\/[^\s<>)"]+)\)/gu;
const PARENTHETICAL_URL_PATTERN = /\s\((https?:\/\/[^\s<>)"]+)\)/gu;
const TRAILING_PUNCTUATION_PATTERN = /[.,!?;:)]/;
const MAX_PARENTHETICAL_LABEL_LOOKBACK = 200;
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

  for (const match of body.matchAll(MARKDOWN_LINK_PATTERN)) {
    const rawMatch = match[0];
    const matchIndex = match.index;
    const markdownLabel = match[1];
    const markdownHref = match[2];
    const label = markdownLabel;
    const href = markdownHref;

    if (label === undefined || href === undefined) {
      continue;
    }

    nodes.push(
      ...renderNonMarkdownLinks(
        body.slice(cursor, matchIndex),
        `plain-${String(index)}`,
        linkClassName,
      ),
    );
    nodes.push(
      renderLink(href, label.trim(), `rich-${String(index)}`, linkClassName),
    );
    cursor = matchIndex + rawMatch.length;
    index += 1;
  }

  nodes.push(
    ...renderNonMarkdownLinks(
      body.slice(cursor),
      `plain-${String(index)}`,
      linkClassName,
    ),
  );

  return nodes;
}

function renderNonMarkdownLinks(
  segment: string,
  keyPrefix: string,
  linkClassName?: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;

  while (cursor < segment.length) {
    const parentheticalLink = findNextParentheticalLink(segment, cursor);

    if (parentheticalLink === null) {
      nodes.push(
        ...renderBareUrls(
          segment.slice(cursor),
          `${keyPrefix}-plain-${String(index)}`,
          linkClassName,
        ),
      );
      break;
    }

    nodes.push(
      ...renderBareUrls(
        segment.slice(cursor, parentheticalLink.labelStart),
        `${keyPrefix}-plain-${String(index)}`,
        linkClassName,
      ),
    );
    nodes.push(
      renderLink(
        parentheticalLink.href,
        parentheticalLink.label,
        `${keyPrefix}-parenthetical-${String(index)}`,
        linkClassName,
      ),
    );

    cursor = parentheticalLink.end;
    index += 1;
  }

  return nodes;
}

function findNextParentheticalLink(
  segment: string,
  fromIndex: number,
): { href: string; label: string; labelStart: number; end: number } | null {
  const pattern = new RegExp(PARENTHETICAL_URL_PATTERN.source, "gu");
  pattern.lastIndex = fromIndex;

  for (const match of segment.matchAll(pattern)) {
    const matchIndex = match.index;
    const href = match[1];

    if (href === undefined) {
      continue;
    }

    const openParenthesisIndex = matchIndex + 1;
    const label = findParentheticalLabel(segment, openParenthesisIndex);

    if (label === null) {
      continue;
    }

    return {
      href,
      label: label.text,
      labelStart: label.start,
      end: matchIndex + match[0].length,
    };
  }

  return null;
}

function findParentheticalLabel(
  segment: string,
  openParenthesisIndex: number,
): { start: number; text: string } | null {
  const labelEnd = openParenthesisIndex - 1;
  const searchStart = Math.max(
    0,
    labelEnd - MAX_PARENTHETICAL_LABEL_LOOKBACK,
  );

  for (let index = labelEnd - 1; index >= searchStart; index -= 1) {
    const boundaryStart = getBoundaryStart(segment, index, labelEnd);

    if (boundaryStart === null) {
      continue;
    }

    const text = segment.slice(boundaryStart, labelEnd).trim();

    if (isValidParentheticalLabel(text)) {
      return {
        start: boundaryStart,
        text,
      };
    }

    return null;
  }

  if (searchStart === 0) {
    const boundaryStart = advancePastWhitespace(segment, 0, labelEnd);
    const text = segment.slice(boundaryStart, labelEnd).trim();

    if (isValidParentheticalLabel(text)) {
      return {
        start: boundaryStart,
        text,
      };
    }
  }

  return null;
}

function getBoundaryStart(
  segment: string,
  index: number,
  labelEnd: number,
): number | null {
  const currentCharacter = segment[index];
  const nextCharacter = segment[index + 1];

  if (currentCharacter === "\n") {
    return advancePastWhitespace(segment, index + 1, labelEnd);
  }

  if (
    currentCharacter !== undefined &&
    ".!?,;:>".includes(currentCharacter) &&
    nextCharacter !== undefined &&
    isWhitespace(nextCharacter)
  ) {
    return advancePastWhitespace(segment, index + 1, labelEnd);
  }

  return null;
}

function advancePastWhitespace(
  segment: string,
  index: number,
  limit: number,
): number {
  let cursor = index;

  while (cursor < limit && isWhitespace(segment[cursor])) {
    cursor += 1;
  }

  return cursor;
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/u.test(character);
}

function isValidParentheticalLabel(label: string): boolean {
  return label.length > 0 && !/[()[\]\n]/u.test(label);
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
      nodes.push(
        renderLink(href, href, `${keyPrefix}-${String(index)}`, linkClassName),
      );
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
