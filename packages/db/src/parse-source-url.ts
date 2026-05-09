const NOTION_HOST_PATTERN = /(^|\.)notion\.so$/u;
const NOTION_ID_PATTERN =
  /([0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/iu;

function normalizeUrlInput(value: string): string {
  return value.trim();
}

function normalizeWebUrl(url: URL): string {
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  return url.toString();
}

function normalizeNotionSourceId(value: string): string {
  const normalized = value.trim().replace(/-/gu, "").toLowerCase();

  if (!/^[0-9a-f]{32}$/u.test(normalized)) {
    throw new AiKnowledgeSourceValidationError({
      code: "invalid_url",
      message: `Invalid Notion page ID: ${value}`
    });
  }

  return normalized;
}

function isNotionHost(hostname: string): boolean {
  return NOTION_HOST_PATTERN.test(hostname.toLowerCase());
}

export class AiKnowledgeSourceValidationError extends Error {
  readonly code:
    | "duplicate_source"
    | "invalid_url"
    | "source_not_found";

  constructor(input: {
    readonly code: AiKnowledgeSourceValidationError["code"];
    readonly message: string;
  }) {
    super(input.message);
    this.name = "AiKnowledgeSourceValidationError";
    this.code = input.code;
  }
}

export function parseSourceUrl(url: string): {
  readonly kind: "notion" | "web_page";
  readonly source_id: string | null;
  readonly normalized_url: string;
} {
  const trimmedUrl = normalizeUrlInput(url);

  if (trimmedUrl.length === 0) {
    throw new AiKnowledgeSourceValidationError({
      code: "invalid_url",
      message: "AI knowledge source URL is required."
    });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new AiKnowledgeSourceValidationError({
      code: "invalid_url",
      message: `Invalid AI knowledge source URL: ${url}`
    });
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new AiKnowledgeSourceValidationError({
      code: "invalid_url",
      message: `Unsupported AI knowledge source URL scheme: ${parsedUrl.protocol}`
    });
  }

  if (isNotionHost(parsedUrl.hostname)) {
    const notionIdMatch = NOTION_ID_PATTERN.exec(parsedUrl.pathname);
    const notionId = notionIdMatch?.[1];

    if (notionId === undefined) {
      throw new AiKnowledgeSourceValidationError({
        code: "invalid_url",
        message: `Could not extract a Notion page ID from URL: ${url}`
      });
    }

    const sourceId = normalizeNotionSourceId(notionId);
    return {
      kind: "notion",
      source_id: sourceId,
      normalized_url: `https://www.notion.so/${sourceId}`
    };
  }

  const normalizedUrl = normalizeWebUrl(parsedUrl);
  return {
    kind: "web_page",
    source_id: normalizedUrl,
    normalized_url: normalizedUrl
  };
}
