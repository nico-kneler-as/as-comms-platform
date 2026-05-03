#!/usr/bin/env tsx
/**
 * dump-notion-page
 *
 * One-off architect tool to dump a Notion page's title + markdown to stdout.
 * Useful for design-discussion grounding when reading Notion content from CLI.
 *
 * Usage:
 *   railway run -- pnpm --filter @as-comms/worker exec tsx src/ops/dump-notion-page.ts <pageIdOrUrl>
 *
 * The pageId argument can be a 32-char hex id, a hyphenated UUID, or a full
 * Notion page URL (the trailing 32-char hex segment is extracted).
 */
import process from "node:process";

import {
  createNotionClient,
  fetchPageContent,
  describeNotionError,
} from "@as-comms/integrations";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: dump-notion-page <pageIdOrUrl>");
    process.exit(2);
  }

  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    console.error("NOTION_API_KEY is required (use `railway run --` to inject).");
    process.exit(2);
  }

  const client = createNotionClient({ NOTION_API_KEY: apiKey });

  try {
    const content = await fetchPageContent(client, arg);
    console.log(`# ${content.title ?? "(untitled)"}`);
    console.log(`URL: ${content.url ?? "(none)"}`);
    console.log(`Last edited: ${content.lastEditedTime}`);
    console.log("");
    console.log(content.markdown);
  } catch (error) {
    console.error(`Notion fetch failed: ${describeNotionError(error)}`);
    process.exit(1);
  }
}

void main();
