import { createHash } from "node:crypto";

import type { AiKnowledgeSourceKind } from "@as-comms/contracts";

import {
  NotionProviderError,
  createNotionClient,
  fetchPageContent,
  normalizeNotionId,
  type NotionClient,
} from "./providers/notion.js";

function hashContent(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

function humanizeNotionFetchError(error: NotionProviderError): string {
  switch (error.code) {
    case "not_found":
    case "unauthorized":
      // 404/403 from Notion almost always means the page hasn't been shared
      // with our integration. Notion returns 404 for unshared pages even when
      // they exist, so we coalesce both codes into the same actionable message.
      return "Notion can't access this page. Open it in Notion and share it with the AS Comms integration (Share → Connections → add AS Comms).";
    case "timeout":
      return "Notion request timed out.";
    case "rate_limited":
      return "Notion rate limited the request.";
    case "retryable":
      return "Notion is temporarily unavailable.";
    case "invalid_response":
      return "Notion returned an invalid response.";
    case "unexpected":
      return error.message;
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function htmlToMarkdown(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/giu, "\n")
      .replace(/<li\b[^>]*>/giu, "- ")
      .replace(/<\/tr>/giu, "\n")
      .replace(/<[^>]+>/gu, " ")
      .replace(/\r/gu, "")
      .replace(/[ \t]+\n/gu, "\n")
      .replace(/\n{3,}/gu, "\n\n")
      .replace(/[ \t]{2,}/gu, " ")
      .trim(),
  );
}

function extractNotionPageId(url: string): string | null {
  const trimmedUrl = url.trim();

  if (/^[0-9a-fA-F-]{32,36}$/u.test(trimmedUrl)) {
    return normalizeNotionId(trimmedUrl);
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);

    for (let index = pathSegments.length - 1; index >= 0; index -= 1) {
      const segment = pathSegments[index];
      if (segment === undefined) {
        continue;
      }

      const match = /([0-9a-fA-F]{32}|[0-9a-fA-F-]{36})/u.exec(segment);
      if (match?.[1] !== undefined) {
        return normalizeNotionId(match[1]);
      }
    }
  } catch {
    return null;
  }

  return null;
}

export interface SourceFetcherInput {
  readonly url: string;
  readonly sourceId: string | null;
  readonly lastContentHash: string | null;
  readonly lastModified?: string | null;
}

export type SourceFetchResult =
  | {
      readonly ok: true;
      readonly content: string;
      readonly contentHash: string;
      readonly lastModified: string | null;
      readonly unchanged: false;
    }
  | {
      readonly ok: true;
      readonly unchanged: true;
      readonly lastModified: string | null;
    }
  | {
      readonly ok: false;
      readonly status: "broken";
      readonly error: string;
    };

export interface SourceFetcher {
  readonly kind: AiKnowledgeSourceKind;
  fetch(input: SourceFetcherInput): Promise<SourceFetchResult>;
}

export class NotionPageFetcher implements SourceFetcher {
  readonly kind = "notion" as const;

  readonly #createClient: (env: { readonly NOTION_API_KEY: string }) => NotionClient;
  readonly #apiKey: string;

  constructor(input: {
    readonly apiKey: string;
    readonly createClient?: (env: {
      readonly NOTION_API_KEY: string;
    }) => NotionClient;
  }) {
    this.#apiKey = input.apiKey;
    this.#createClient = input.createClient ?? createNotionClient;
  }

  async fetch(input: SourceFetcherInput): Promise<SourceFetchResult> {
    const resolvedPageId =
      input.sourceId ?? extractNotionPageId(input.url.trim());

    if (resolvedPageId === null) {
      return {
        ok: false,
        status: "broken",
        error: "Could not resolve a Notion page ID from the configured source.",
      };
    }

    const client = this.#createClient({
      NOTION_API_KEY: this.#apiKey,
    });

    try {
      const page = await client.retrievePage(resolvedPageId);
      const lastEditedTime =
        typeof page.last_edited_time === "string" ? page.last_edited_time : null;

      if (
        input.lastModified !== undefined &&
        input.lastModified !== null &&
        lastEditedTime !== null &&
        Date.parse(lastEditedTime) <= Date.parse(input.lastModified)
      ) {
        return {
          ok: true,
          unchanged: true,
          lastModified: lastEditedTime,
        };
      }

      const content = await fetchPageContent(client, resolvedPageId);

      return {
        ok: true,
        unchanged: false,
        content: content.markdown,
        contentHash: hashContent(content.markdown),
        lastModified: content.lastEditedTime,
      };
    } catch (error) {
      const classified =
        error instanceof NotionProviderError
          ? error
          : new NotionProviderError({
              code: "unexpected",
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
            });

      return {
        ok: false,
        status: "broken",
        error: humanizeNotionFetchError(classified),
      };
    }
  }
}

// Caps on what the WebPageFetcher accepts. The fetcher is wired into the
// AI Knowledge synthesis prompt, which has a 1M-token Claude input ceiling.
// Without these caps a single rogue source (e.g. a 7MB PDF served at a web
// URL — see Killer Whales skw_protocols.pdf, 2026-05-10) blows past 2M
// tokens and the synthesis job dies with invalid_request_error.
const MAX_WEB_PAGE_BODY_BYTES = 2_000_000; // ~2MB ceiling on raw body
const ALLOWED_TEXT_CONTENT_TYPES = [
  "text/html",
  "text/plain",
  "application/xhtml+xml",
  "application/xml",
  "text/xml",
] as const;

function isTextContentType(contentType: string | null): boolean {
  if (contentType === null) {
    // No header — assume text and let the body parse pass/fail. Conservative
    // server defaults (especially generic CDNs) sometimes drop the header.
    return true;
  }
  const lowered = contentType.toLowerCase();
  return ALLOWED_TEXT_CONTENT_TYPES.some((allowed) =>
    lowered.startsWith(allowed),
  );
}

export class WebPageFetcher implements SourceFetcher {
  readonly kind = "web_page" as const;

  readonly #fetchImplementation: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxBodyBytes: number;

  constructor(input?: {
    readonly fetchImplementation?: typeof fetch;
    readonly timeoutMs?: number;
    readonly maxBodyBytes?: number;
  }) {
    this.#fetchImplementation = input?.fetchImplementation ?? globalThis.fetch;
    this.#timeoutMs = input?.timeoutMs ?? 15_000;
    this.#maxBodyBytes = input?.maxBodyBytes ?? MAX_WEB_PAGE_BODY_BYTES;
  }

  async fetch(input: SourceFetcherInput): Promise<SourceFetchResult> {
    if (typeof this.#fetchImplementation !== "function") {
      return {
        ok: false,
        status: "broken",
        error: "Global fetch is unavailable.",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.#timeoutMs);

    try {
      const init: RequestInit = {
        method: "GET",
        signal: controller.signal,
      };
      if (input.lastModified !== undefined && input.lastModified !== null) {
        init.headers = { "if-modified-since": input.lastModified };
      }
      const response = await this.#fetchImplementation(input.url, init);

      if (response.status === 304) {
        return {
          ok: true,
          unchanged: true,
          lastModified: response.headers.get("last-modified") ?? input.lastModified ?? null,
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          status: "broken",
          error: `HTTP ${String(response.status)}`,
        };
      }

      const contentType = response.headers.get("content-type");
      if (!isTextContentType(contentType)) {
        return {
          ok: false,
          status: "broken",
          error: `Unsupported content type "${contentType ?? "unknown"}". Web sources must serve text/html or text/plain — host the document as a Notion page or HTML article.`,
        };
      }

      const declaredLength = response.headers.get("content-length");
      if (declaredLength !== null) {
        const parsed = Number.parseInt(declaredLength, 10);
        if (Number.isFinite(parsed) && parsed > this.#maxBodyBytes) {
          return {
            ok: false,
            status: "broken",
            error: `Source body is ${String(parsed)} bytes — exceeds the ${String(this.#maxBodyBytes)}-byte ceiling. Trim the source or split into smaller pages.`,
          };
        }
      }

      const body = await response.text();
      if (body.length > this.#maxBodyBytes) {
        return {
          ok: false,
          status: "broken",
          error: `Source body is ${String(body.length)} bytes — exceeds the ${String(this.#maxBodyBytes)}-byte ceiling. Trim the source or split into smaller pages.`,
        };
      }
      const content = htmlToMarkdown(body);

      return {
        ok: true,
        unchanged: false,
        content,
        contentHash: hashContent(content),
        lastModified: response.headers.get("last-modified"),
      };
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        return {
          ok: false,
          status: "broken",
          error: "Timeout",
        };
      }

      return {
        ok: false,
        status: "broken",
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class InlineTextFetcher implements SourceFetcher {
  readonly kind = "inline_text" as const;

  fetch(input: SourceFetcherInput): Promise<SourceFetchResult> {
    return Promise.resolve({
      ok: true,
      unchanged: false,
      content: input.url,
      contentHash: hashContent(input.url),
      lastModified: null,
    });
  }
}
