import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const DEFAULT_NOTION_TIMEOUT_MS = 15_000;
const DEFAULT_NOTION_API_VERSION = "2022-06-28";
const DEFAULT_NOTION_PAGE_SIZE = 100;

export type NotionLogger = Pick<Console, "warn">;

export class NotionProviderError extends Error {
  readonly code:
    | "timeout"
    | "rate_limited"
    | "retryable"
    | "not_found"
    | "unauthorized"
    | "invalid_response"
    | "unexpected";
  readonly retryable: boolean;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(input: {
    readonly code: NotionProviderError["code"];
    readonly message: string;
    readonly retryable: boolean;
    readonly status?: number | null;
    readonly retryAfterSeconds?: number | null;
  }) {
    super(input.message);
    this.name = "NotionProviderError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.status = input.status ?? null;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
  }
}

export interface NotionClient {
  readonly logger?: NotionLogger;
  retrievePage(pageId: string): Promise<Record<string, unknown>>;
  listBlockChildren(input: {
    readonly blockId: string;
    readonly startCursor?: string;
    readonly pageSize?: number;
  }): Promise<Record<string, unknown>>;
  queryDatabase(input: {
    readonly databaseId: string;
    readonly startCursor?: string;
    readonly pageSize?: number;
  }): Promise<Record<string, unknown>>;
}

export interface NotionPageContent {
  readonly title: string | null;
  readonly markdown: string;
  readonly lastEditedTime: string;
  readonly url: string | null;
  readonly properties: Record<string, unknown>;
}

export interface DatabaseRow {
  readonly id: string;
  readonly url: string | null;
  readonly properties: Record<string, unknown>;
  readonly lastEditedTime: string;
}

export type HealthResult =
  | { readonly status: "ok" }
  | { readonly status: "error"; readonly errorDetail: string };

interface RichTextToken {
  readonly plainText: string;
  readonly href: string | null;
  readonly annotations: {
    readonly bold: boolean;
    readonly italic: boolean;
    readonly strikethrough: boolean;
    readonly code: boolean;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NotionProviderError({
      code: "invalid_response",
      message,
      retryable: false
    });
  }

  return value;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/gu, " ").replace(/\s+\n/gu, "\n").trim();
}

function ensureMarkdownParagraph(value: string): string {
  return normalizeWhitespace(value);
}

function normalizeMarkdownOutput(value: string): string {
  return value
    .replace(/\r\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function indentMarkdown(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line.length === 0 ? line : `${prefix}${line}`))
    .join("\n");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\n/gu, "<br>");
}

function titleCaseBlockType(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizePageId(input: string): string {
  const normalized = input.trim().replace(/-/gu, "").toLowerCase();

  if (!/^[0-9a-f]{32}$/u.test(normalized)) {
    throw new NotionProviderError({
      code: "invalid_response",
      message: `Invalid Notion ID: ${input}`,
      retryable: false
    });
  }

  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20)
  ].join("-");
}

export function normalizeNotionId(input: string): string {
  return normalizePageId(input);
}

function parseRetryAfterSeconds(retryAfterHeader: string | null): number | null {
  if (retryAfterHeader === null) {
    return null;
  }

  const numericValue = Number.parseInt(retryAfterHeader, 10);
  if (!Number.isNaN(numericValue) && numericValue >= 0) {
    return numericValue;
  }

  const retryAt = Date.parse(retryAfterHeader);
  if (Number.isNaN(retryAt)) {
    return null;
  }

  const retryAfterSeconds = Math.ceil((retryAt - Date.now()) / 1000);
  return retryAfterSeconds >= 0 ? retryAfterSeconds : 0;
}

function readRetryAfterSeconds(error: Record<string, unknown>): number | null {
  const directHeader = readOptionalString(error.retryAfter);
  if (directHeader !== null) {
    return parseRetryAfterSeconds(directHeader);
  }

  const headers = error.headers;
  if (headers instanceof Headers) {
    return parseRetryAfterSeconds(headers.get("retry-after"));
  }

  if (isRecord(headers)) {
    return parseRetryAfterSeconds(
      readOptionalString(headers["retry-after"]) ??
        readOptionalString(headers.retryAfter)
    );
  }

  return null;
}

export function classifyNotionError(
  error: unknown,
  context: string
): NotionProviderError {
  if (error instanceof NotionProviderError) {
    return error;
  }

  if (error instanceof Error && error.name === "TimeoutError") {
    return new NotionProviderError({
      code: "timeout",
      message: `${context} timed out.`,
      retryable: true
    });
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new NotionProviderError({
      code: "timeout",
      message: `${context} was aborted.`,
      retryable: true
    });
  }

  if (!isRecord(error)) {
    return new NotionProviderError({
      code: "unexpected",
      message: `${context} failed with an unexpected error.`,
      retryable: false
    });
  }

  const status = readOptionalNumber(error.status);
  const code = readOptionalString(error.code);
  const retryAfterSeconds = readRetryAfterSeconds(error);
  const message =
    readOptionalString(error.message) ?? `${context} failed with an unknown error.`;

  if (status === 429 || code === "rate_limited") {
    return new NotionProviderError({
      code: "rate_limited",
      message,
      retryable: true,
      status,
      retryAfterSeconds
    });
  }

  if (status === 401 || status === 403 || code === "unauthorized") {
    return new NotionProviderError({
      code: "unauthorized",
      message,
      retryable: false,
      status
    });
  }

  if (status === 404 || code === "object_not_found") {
    return new NotionProviderError({
      code: "not_found",
      message,
      retryable: false,
      status
    });
  }

  if (status === 500 || status === 503 || status === 504 || code === "service_unavailable") {
    return new NotionProviderError({
      code: "retryable",
      message,
      retryable: true,
      status,
      retryAfterSeconds
    });
  }

  return new NotionProviderError({
    code: "unexpected",
    message,
    retryable: false,
    status,
    retryAfterSeconds
  });
}

export function describeNotionError(error: unknown): string {
  const notionError = classifyNotionError(error, "Notion request");
  const statusPart =
    notionError.status === null ? "" : ` (status ${String(notionError.status)})`;
  const retryPart =
    notionError.retryAfterSeconds === null
      ? ""
      : ` Retry after ${String(notionError.retryAfterSeconds)}s.`;

  return `${notionError.code}${statusPart}: ${notionError.message}${retryPart}`;
}

function executeNotionCall<T>(
  context: string,
  run: () => Promise<T>
): Promise<T> {
  return run().catch((error: unknown) => {
    throw classifyNotionError(error, context);
  });
}

export function createNotionClient(env: {
  readonly NOTION_API_KEY: string;
}): NotionClient {
  const notionModule = require("@notionhq/client") as {
    readonly Client: new (input: Record<string, unknown>) => {
      readonly pages: {
        retrieve(input: Record<string, unknown>): Promise<Record<string, unknown>>;
      };
      readonly blocks: {
        readonly children: {
          list(input: Record<string, unknown>): Promise<Record<string, unknown>>;
        };
      };
      readonly databases: {
        query(input: Record<string, unknown>): Promise<Record<string, unknown>>;
      };
    };
  };

  const notion = new notionModule.Client({
    auth: env.NOTION_API_KEY,
    notionVersion: DEFAULT_NOTION_API_VERSION,
    timeoutMs: DEFAULT_NOTION_TIMEOUT_MS,
    retry: false
  });

  return {
    retrievePage(pageId) {
      return executeNotionCall("Notion page retrieve", () =>
        notion.pages.retrieve({
          page_id: normalizePageId(pageId)
        })
      );
    },
    listBlockChildren(input) {
      return executeNotionCall("Notion block children list", () =>
        notion.blocks.children.list({
          block_id: normalizePageId(input.blockId),
          start_cursor: input.startCursor,
          page_size: input.pageSize ?? DEFAULT_NOTION_PAGE_SIZE
        })
      );
    },
    queryDatabase(input) {
      return executeNotionCall("Notion database query", () =>
        notion.databases.query({
          database_id: normalizePageId(input.databaseId),
          start_cursor: input.startCursor,
          page_size: input.pageSize ?? DEFAULT_NOTION_PAGE_SIZE,
          sorts: [
            {
              timestamp: "last_edited_time",
              direction: "descending"
            }
          ]
        })
      );
    }
  };
}

function readRichTextTokens(value: unknown): RichTextToken[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const annotations = isRecord(item.annotations) ? item.annotations : {};
    const text = readOptionalString(item.plain_text);

    if (text === null) {
      return [];
    }

    return [
      {
        plainText: text,
        href: readOptionalString(item.href),
        annotations: {
          bold: readBoolean(annotations.bold),
          italic: readBoolean(annotations.italic),
          strikethrough: readBoolean(annotations.strikethrough),
          code: readBoolean(annotations.code)
        }
      }
    ];
  });
}

function renderRichText(value: unknown): string {
  return readRichTextTokens(value)
    .map((token) => {
      let text = token.plainText;

      if (token.href !== null) {
        text = `[${text}](${token.href})`;
      }

      if (token.annotations.code) {
        text = `\`${text}\``;
      }

      if (token.annotations.bold) {
        text = `**${text}**`;
      }

      if (token.annotations.italic) {
        text = `*${text}*`;
      }

      if (token.annotations.strikethrough) {
        text = `~~${text}~~`;
      }

      return text;
    })
    .join("");
}

function extractPageTitle(properties: Record<string, unknown>): string | null {
  for (const property of Object.values(properties)) {
    if (!isRecord(property) || property.type !== "title") {
      continue;
    }

    const title = renderRichText(property.title);
    return title.trim().length > 0 ? title.trim() : null;
  }

  return null;
}

function extractBlockText(block: Record<string, unknown>): string {
  const type = readOptionalString(block.type);
  if (type === null) {
    return "";
  }

  const data = isRecord(block[type]) ? block[type] : null;
  if (data === null) {
    return "";
  }

  if ("rich_text" in data) {
    return ensureMarkdownParagraph(renderRichText(data.rich_text));
  }

  if ("caption" in data) {
    return ensureMarkdownParagraph(renderRichText(data.caption));
  }

  if ("title" in data) {
    return ensureMarkdownParagraph(readOptionalString(data.title) ?? "");
  }

  if ("url" in data) {
    return ensureMarkdownParagraph(readOptionalString(data.url) ?? "");
  }

  return "";
}

async function listAllBlockChildren(
  client: NotionClient,
  blockId: string
): Promise<readonly Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await client.listBlockChildren({
      blockId,
      ...(cursor !== undefined ? { startCursor: cursor } : {}),
      pageSize: DEFAULT_NOTION_PAGE_SIZE
    });
    const rawResults = Array.isArray(page.results) ? page.results : [];

    for (const rawResult of rawResults) {
      if (isRecord(rawResult)) {
        results.push(rawResult);
      }
    }

    if (page.has_more !== true) {
      return results;
    }

    cursor = readOptionalString(page.next_cursor) ?? undefined;
    if (cursor === undefined) {
      return results;
    }
  }
}

async function renderTableBlock(
  client: NotionClient,
  block: Record<string, unknown>,
  logger: NotionLogger
): Promise<string> {
  const table = isRecord(block.table) ? block.table : {};
  const hasColumnHeader = readBoolean(table.has_column_header);
  const rows = await listAllBlockChildren(
    client,
    readString(block.id, "Notion table block is missing an id.")
  );

  const normalizedRows = rows.flatMap((row) => {
    if (row.type !== "table_row" || !isRecord(row.table_row)) {
      logger.warn("Encountered a non-table-row child while flattening a Notion table.");
      return [];
    }

    const cells = Array.isArray(row.table_row.cells) ? row.table_row.cells : [];
    return [
      cells.map((cell) => escapeTableCell(ensureMarkdownParagraph(renderRichText(cell))))
    ];
  });

  if (normalizedRows.length === 0) {
    return "";
  }

  const width = Math.max(
    readOptionalNumber(table.table_width) ?? 0,
    ...normalizedRows.map((row) => row.length),
    1
  );
  const paddedRows = normalizedRows.map((row) =>
    Array.from({ length: width }, (_value, index) => row[index] ?? "")
  );
  const header = hasColumnHeader
    ? paddedRows[0] ?? Array.from({ length: width }, (_value, index) => `Column ${String(index + 1)}`)
    : Array.from({ length: width }, (_value, index) => `Column ${String(index + 1)}`);
  const body = hasColumnHeader ? paddedRows.slice(1) : paddedRows;

  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

async function renderNestedChildren(
  client: NotionClient,
  block: Record<string, unknown>,
  logger: NotionLogger
): Promise<string> {
  if (block.has_children !== true || block.type === "table") {
    return "";
  }

  const childBlocks = await listAllBlockChildren(
    client,
    readString(block.id, "Notion block is missing an id.")
  );
  if (childBlocks.length === 0) {
    return "";
  }

  const markdown = await renderBlocksToMarkdown(client, childBlocks, logger);
  return markdown.length === 0 ? "" : indentMarkdown(markdown, 2);
}

async function renderBlock(
  client: NotionClient,
  block: Record<string, unknown>,
  logger: NotionLogger,
  numberedListIndex: number
): Promise<{ readonly markdown: string; readonly nextNumberedListIndex: number }> {
  const type = readOptionalString(block.type);
  if (type === null) {
    logger.warn("Encountered a Notion block without a type while flattening page content.");
    return {
      markdown: "",
      nextNumberedListIndex: 0
    };
  }

  const text = extractBlockText(block);
  const nestedMarkdown = await renderNestedChildren(client, block, logger);

  switch (type) {
    case "paragraph": {
      const parts = [text, nestedMarkdown].filter((value) => value.length > 0);
      return {
        markdown: parts.join("\n\n"),
        nextNumberedListIndex: 0
      };
    }
    case "heading_1":
      return {
        markdown: `# ${text}`,
        nextNumberedListIndex: 0
      };
    case "heading_2":
      return {
        markdown: `## ${text}`,
        nextNumberedListIndex: 0
      };
    case "heading_3":
      return {
        markdown: `### ${text}`,
        nextNumberedListIndex: 0
      };
    case "bulleted_list_item": {
      const parts = [`- ${text}`];
      if (nestedMarkdown.length > 0) {
        parts.push(nestedMarkdown);
      }

      return {
        markdown: parts.join("\n"),
        nextNumberedListIndex: 0
      };
    }
    case "numbered_list_item": {
      const nextIndex = numberedListIndex + 1;
      const parts = [`${String(nextIndex)}. ${text}`];
      if (nestedMarkdown.length > 0) {
        parts.push(nestedMarkdown);
      }

      return {
        markdown: parts.join("\n"),
        nextNumberedListIndex: nextIndex
      };
    }
    case "quote":
      return {
        markdown: `> ${text}`,
        nextNumberedListIndex: 0
      };
    case "code": {
      const code = isRecord(block.code) ? block.code : {};
      const language = readOptionalString(code.language) ?? "";
      const fencedCode = renderRichText(code.rich_text);

      return {
        markdown: `\`\`\`${language}\n${fencedCode}\n\`\`\``,
        nextNumberedListIndex: 0
      };
    }
    case "to_do": {
      const toDo = isRecord(block.to_do) ? block.to_do : {};
      const checked = readBoolean(toDo.checked) ? "x" : " ";
      const parts = [`- [${checked}] ${renderRichText(toDo.rich_text)}`];
      if (nestedMarkdown.length > 0) {
        parts.push(nestedMarkdown);
      }

      return {
        markdown: parts.join("\n"),
        nextNumberedListIndex: 0
      };
    }
    case "divider":
      return {
        markdown: "---",
        nextNumberedListIndex: 0
      };
    case "table":
      return {
        markdown: await renderTableBlock(client, block, logger),
        nextNumberedListIndex: 0
      };
    default: {
      logger.warn(
        `Unsupported Notion block type "${type}" encountered; flattening as plain text.`
      );

      const fallbackText =
        text.length > 0 ? text : `[${titleCaseBlockType(type)}]`;
      const parts = [fallbackText];
      if (nestedMarkdown.length > 0) {
        parts.push(nestedMarkdown);
      }

      return {
        markdown: parts.join("\n\n"),
        nextNumberedListIndex: 0
      };
    }
  }
}

async function renderBlocksToMarkdown(
  client: NotionClient,
  blocks: readonly Record<string, unknown>[],
  logger: NotionLogger
): Promise<string> {
  const renderedBlocks: string[] = [];
  let numberedListIndex = 0;

  for (const block of blocks) {
    const rendered = await renderBlock(client, block, logger, numberedListIndex);
    numberedListIndex = rendered.nextNumberedListIndex;

    if (
      readOptionalString(block.type) !== "numbered_list_item" &&
      rendered.nextNumberedListIndex === 0
    ) {
      numberedListIndex = 0;
    }

    if (rendered.markdown.trim().length > 0) {
      renderedBlocks.push(rendered.markdown.trim());
    }
  }

  return normalizeMarkdownOutput(renderedBlocks.join("\n\n"));
}

export async function fetchPageContent(
  client: NotionClient,
  pageId: string
): Promise<NotionPageContent> {
  const normalizedPageId = normalizePageId(pageId);
  const page = await client.retrievePage(normalizedPageId);
  const properties = isRecord(page.properties) ? page.properties : {};
  const title = extractPageTitle(properties);
  const blocks = await listAllBlockChildren(client, normalizedPageId);
  const logger = client.logger ?? console;

  return {
    title,
    markdown: await renderBlocksToMarkdown(client, blocks, logger),
    lastEditedTime: readString(
      page.last_edited_time,
      "Notion page response is missing last_edited_time."
    ),
    url: readOptionalString(page.url),
    properties
  };
}

function toDatabaseRow(result: Record<string, unknown>): DatabaseRow {
  return {
    id: normalizePageId(
      readString(result.id, "Notion database query result is missing an id.")
    ),
    url: readOptionalString(result.url),
    properties: isRecord(result.properties) ? result.properties : {},
    lastEditedTime: readString(
      result.last_edited_time,
      "Notion database query result is missing last_edited_time."
    )
  };
}

export async function* queryDatabase(
  client: NotionClient,
  databaseId: string
): AsyncIterable<DatabaseRow> {
  const normalizedDatabaseId = normalizePageId(databaseId);
  let cursor: string | undefined;

  for (;;) {
    const page = await client.queryDatabase({
      databaseId: normalizedDatabaseId,
      ...(cursor !== undefined ? { startCursor: cursor } : {}),
      pageSize: DEFAULT_NOTION_PAGE_SIZE
    });
    const results = Array.isArray(page.results) ? page.results : [];

    for (const result of results) {
      if (isRecord(result)) {
        yield toDatabaseRow(result);
      }
    }

    if (page.has_more !== true) {
      return;
    }

    cursor = readOptionalString(page.next_cursor) ?? undefined;
    if (cursor === undefined) {
      return;
    }
  }
}

export async function healthCheck(
  client: NotionClient,
  input: {
    readonly generalTrainingPageId: string;
    readonly projectTrainingDatabaseId: string;
  }
): Promise<HealthResult> {
  try {
    await client.retrievePage(input.generalTrainingPageId);
  } catch (error) {
    return {
      status: "error",
      errorDetail: `General Training page check failed: ${describeNotionError(error)}`
    };
  }

  try {
    await client.queryDatabase({
      databaseId: input.projectTrainingDatabaseId,
      pageSize: 1
    });
  } catch (error) {
    return {
      status: "error",
      errorDetail: `Project Training database check failed: ${describeNotionError(error)}`
    };
  }

  return {
    status: "ok"
  };
}
