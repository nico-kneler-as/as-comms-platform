import { normalizeNotionId } from "./providers/notion.js";

const DEFAULT_NOTION_VERSION = "2022-06-28";
const DEFAULT_TIMEOUT_MS = 15_000;
const NOTION_MAX_CHILDREN_PER_REQUEST = 100;

interface RichTextSegment {
  readonly type: "text";
  readonly text: {
    readonly content: string;
    readonly link?: { readonly url: string };
  };
}

type NotionBlock = Record<string, unknown>;

export interface CreateNotionMarkdownPageInput {
  readonly apiKey: string;
  readonly parentPageId: string;
  readonly title: string;
  readonly markdown: string;
  readonly fetchImplementation?: typeof fetch;
  readonly notionVersion?: string;
  readonly timeoutMs?: number;
}

export interface CreateNotionMarkdownPageResult {
  readonly id: string;
  readonly url: string;
  readonly blockCount: number;
}

function parseInlineLinks(text: string): readonly RichTextSegment[] {
  const segments: RichTextSegment[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/gu;
  let lastIndex = 0;

  for (const match of text.matchAll(linkRegex)) {
    const fullMatch = match[0];
    const linkText = match[1] ?? "";
    const linkUrl = match[2] ?? "";
    const matchIndex = match.index;

    if (matchIndex > lastIndex) {
      segments.push({
        type: "text",
        text: { content: text.slice(lastIndex, matchIndex) },
      });
    }

    segments.push({
      type: "text",
      text: {
        content: linkText,
        link: { url: linkUrl },
      },
    });

    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < text.length) {
    segments.push({
      type: "text",
      text: { content: text.slice(lastIndex) },
    });
  }

  if (segments.length === 0) {
    return [{ type: "text", text: { content: text } }];
  }

  return segments;
}

function lineToBlock(line: string): NotionBlock | null {
  const trimmed = line.trimEnd();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed === "---") {
    return { object: "block", type: "divider", divider: {} };
  }

  if (trimmed.startsWith("### ")) {
    return {
      object: "block",
      type: "heading_3",
      heading_3: { rich_text: parseInlineLinks(trimmed.slice(4)) },
    };
  }

  if (trimmed.startsWith("## ")) {
    return {
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: parseInlineLinks(trimmed.slice(3)) },
    };
  }

  if (trimmed.startsWith("# ")) {
    return {
      object: "block",
      type: "heading_1",
      heading_1: { rich_text: parseInlineLinks(trimmed.slice(2)) },
    };
  }

  if (trimmed.startsWith("- ")) {
    return {
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: { rich_text: parseInlineLinks(trimmed.slice(2)) },
    };
  }

  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: parseInlineLinks(trimmed) },
  };
}

async function notionFetchJson<TResult>(
  input: {
    readonly apiKey: string;
    readonly url: string;
    readonly method: "POST" | "PATCH";
    readonly body: Record<string, unknown>;
    readonly notionVersion: string;
    readonly timeoutMs: number;
    readonly fetchImplementation: typeof fetch;
  },
): Promise<TResult> {
  const response = await input.fetchImplementation(input.url, {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Notion-Version": input.notionVersion,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.body),
    signal: AbortSignal.timeout(input.timeoutMs),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion API error ${String(response.status)} ${response.statusText}: ${errorText}`,
    );
  }

  return (await response.json()) as TResult;
}

export async function createNotionMarkdownPage(
  input: CreateNotionMarkdownPageInput,
): Promise<CreateNotionMarkdownPageResult> {
  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch;

  if (typeof fetchImplementation !== "function") {
    throw new Error("Global fetch is unavailable.");
  }

  const blocks = input.markdown
    .split("\n")
    .map(lineToBlock)
    .filter((block): block is NotionBlock => block !== null);

  const firstHeadingIndex = blocks.findIndex((block) => block.type === "heading_1");
  if (firstHeadingIndex >= 0) {
    blocks.splice(firstHeadingIndex, 1);
  }

  const initialChunk = blocks.slice(0, NOTION_MAX_CHILDREN_PER_REQUEST);
  const remainingChunks: NotionBlock[][] = [];

  for (
    let index = NOTION_MAX_CHILDREN_PER_REQUEST;
    index < blocks.length;
    index += NOTION_MAX_CHILDREN_PER_REQUEST
  ) {
    remainingChunks.push(
      blocks.slice(index, index + NOTION_MAX_CHILDREN_PER_REQUEST),
    );
  }

  const page = await notionFetchJson<{ readonly id: string; readonly url: string }>({
    apiKey: input.apiKey,
    url: "https://api.notion.com/v1/pages",
    method: "POST",
    body: {
      parent: {
        type: "page_id",
        page_id: normalizeNotionId(input.parentPageId),
      },
      properties: {
        title: [{ type: "text", text: { content: input.title } }],
      },
      children: initialChunk,
    },
    notionVersion: input.notionVersion ?? DEFAULT_NOTION_VERSION,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    fetchImplementation,
  });

  for (const chunk of remainingChunks) {
    await notionFetchJson({
      apiKey: input.apiKey,
      url: `https://api.notion.com/v1/blocks/${normalizeNotionId(page.id)}/children`,
      method: "PATCH",
      body: { children: chunk },
      notionVersion: input.notionVersion ?? DEFAULT_NOTION_VERSION,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetchImplementation,
    });
  }

  return {
    id: normalizeNotionId(page.id),
    url: page.url,
    blockCount: blocks.length,
  };
}
