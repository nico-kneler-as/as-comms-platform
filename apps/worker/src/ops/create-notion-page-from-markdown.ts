#!/usr/bin/env tsx
/**
 * create-notion-page-from-markdown
 *
 * One-off architect tool to create a Notion page (as a child of a parent page)
 * from a local markdown file. Useful for proposing optimized AI-knowledge pages
 * during design iteration.
 *
 * Markdown subset supported:
 * - `# `, `## `, `### ` → heading_1 / heading_2 / heading_3
 * - `- ` → bulleted_list_item
 * - `---` → divider
 * - `[text](url)` inline links → preserved as Notion rich_text links
 * - Other lines → paragraph
 * - The first heading_1 in the file is dropped (the page title is set via arg).
 *
 * Usage:
 *   railway run -- pnpm --filter @as-comms/worker exec tsx \
 *     src/ops/create-notion-page-from-markdown.ts <parentPageId> "Title" <markdownFile>
 */
import process from "node:process";
import { readFile } from "node:fs/promises";

const NOTION_VERSION = "2022-06-28";

interface RichTextSegment {
  readonly type: "text";
  readonly text: { readonly content: string; readonly link?: { readonly url: string } };
}

type Block = Record<string, unknown>;

function parseInlineLinks(text: string): RichTextSegment[] {
  const segments: RichTextSegment[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", text: { content: text.slice(lastIndex, match.index) } });
    }
    const linkText = match[1] ?? "";
    const linkUrl = match[2] ?? "";
    segments.push({
      type: "text",
      text: { content: linkText, link: { url: linkUrl } },
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", text: { content: text.slice(lastIndex) } });
  }
  if (segments.length === 0) {
    return [{ type: "text", text: { content: text } }];
  }
  return segments;
}

function lineToBlock(line: string): Block | null {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0) return null;
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

async function main() {
  const parentPageId = process.argv[2];
  const title = process.argv[3];
  const markdownPath = process.argv[4];
  if (!parentPageId || !title || !markdownPath) {
    console.error(
      "Usage: create-notion-page-from-markdown <parentPageId> <title> <markdownPath>",
    );
    process.exit(2);
  }

  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    console.error("NOTION_API_KEY required (use `railway run --` to inject).");
    process.exit(2);
  }

  const markdown = await readFile(markdownPath, "utf-8");
  const blocks = markdown
    .split("\n")
    .map(lineToBlock)
    .filter((b): b is Block => b !== null);

  // Drop the first heading_1; the page title is already set via the arg
  const firstHeadingIndex = blocks.findIndex((b) => b.type === "heading_1");
  if (firstHeadingIndex >= 0) {
    blocks.splice(firstHeadingIndex, 1);
  }

  // Notion accepts up to 100 children per request — chunk as needed
  const CHUNK_SIZE = 100;
  const initialChunk = blocks.slice(0, CHUNK_SIZE);
  const remainingChunks: Block[][] = [];
  for (let i = CHUNK_SIZE; i < blocks.length; i += CHUNK_SIZE) {
    remainingChunks.push(blocks.slice(i, i + CHUNK_SIZE));
  }

  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentPageId },
      properties: {
        title: [{ type: "text", text: { content: title } }],
      },
      children: initialChunk,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(
      `Notion API error ${String(response.status)} ${response.statusText}`,
    );
    console.error(error);
    process.exit(1);
  }

  const page = (await response.json()) as { id: string; url: string };

  for (let i = 0; i < remainingChunks.length; i++) {
    const chunk = remainingChunks[i];
    const appendResponse = await fetch(
      `https://api.notion.com/v1/blocks/${page.id}/children`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ children: chunk }),
      },
    );
    if (!appendResponse.ok) {
      const error = await appendResponse.text();
      console.error(
        `Notion append (chunk ${String(i + 2)}) error ${String(appendResponse.status)} ${appendResponse.statusText}`,
      );
      console.error(error);
      console.error(
        `Page was created with first ${String(initialChunk.length)} blocks at ${page.url}`,
      );
      process.exit(1);
    }
  }

  console.log(`Created page: ${page.url}`);
  console.log(`Page ID: ${page.id}`);
  console.log(
    `Block count: ${String(blocks.length)} (initial ${String(initialChunk.length)} + ${String(remainingChunks.length)} append chunk${remainingChunks.length === 1 ? "" : "s"})`,
  );
}

void main();
