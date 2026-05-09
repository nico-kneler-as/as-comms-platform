import { describe, expect, it, vi } from "vitest";

import {
  InlineTextFetcher,
  NotionPageFetcher,
  NotionProviderError,
  normalizeNotionId,
  WebPageFetcher,
  type NotionClient,
} from "../src/index.js";

function buildRichText(text: string) {
  return [
    {
      plain_text: text,
      href: null,
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        code: false,
      },
    },
  ];
}

function buildPage(input: {
  readonly id: string;
  readonly lastEditedTime: string;
  readonly title: string;
  readonly url: string;
}) {
  return {
    id: normalizeNotionId(input.id),
    url: input.url,
    last_edited_time: input.lastEditedTime,
    properties: {
      title: {
        type: "title",
        title: buildRichText(input.title),
      },
    },
  };
}

function buildParagraphBlock(id: string, text: string) {
  return {
    id: normalizeNotionId(id),
    type: "paragraph",
    has_children: false,
    paragraph: {
      rich_text: buildRichText(text),
    },
  };
}

function createFakeNotionClient(input: {
  readonly page?: Record<string, unknown>;
  readonly pageError?: Error;
  readonly blocks?: readonly Record<string, unknown>[];
}): NotionClient {
  return {
    retrievePage() {
      if (input.pageError !== undefined) {
        return Promise.reject(input.pageError);
      }

      if (input.page === undefined) {
        return Promise.reject(new Error("Missing page fixture."));
      }

      return Promise.resolve(input.page);
    },
    listBlockChildren() {
      return Promise.resolve({
        results: input.blocks ?? [],
        has_more: false,
        next_cursor: null,
      });
    },
    queryDatabase() {
      return Promise.resolve({
        results: [],
        has_more: false,
        next_cursor: null,
      });
    },
  };
}

describe("AI knowledge fetchers", () => {
  it("fetches Notion page markdown and metadata", async () => {
    const pageId = normalizeNotionId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const fetcher = new NotionPageFetcher({
      apiKey: "test-key",
      createClient: () =>
        createFakeNotionClient({
          page: buildPage({
            id: pageId,
            title: "Project guide",
            lastEditedTime: "2026-05-08T12:00:00.000Z",
            url: "https://www.notion.so/project-guide",
          }),
          blocks: [buildParagraphBlock(pageId, "Volunteer overview")],
        }),
    });

    await expect(
      fetcher.fetch({
        url: `https://www.notion.so/${pageId.replace(/-/gu, "")}`,
        sourceId: pageId,
        lastContentHash: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      unchanged: false,
      content: "Volunteer overview",
      lastModified: "2026-05-08T12:00:00.000Z",
    });
  });

  it("returns unchanged for Notion pages when the last modified timestamp matches", async () => {
    const pageId = normalizeNotionId("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const fetcher = new NotionPageFetcher({
      apiKey: "test-key",
      createClient: () =>
        createFakeNotionClient({
          page: buildPage({
            id: pageId,
            title: "Project guide",
            lastEditedTime: "2026-05-08T12:00:00.000Z",
            url: "https://www.notion.so/project-guide",
          }),
        }),
    });

    await expect(
      fetcher.fetch({
        url: `https://www.notion.so/${pageId.replace(/-/gu, "")}`,
        sourceId: pageId,
        lastContentHash: "ignored",
        lastModified: "2026-05-08T12:00:00.000Z",
      }),
    ).resolves.toEqual({
      ok: true,
      unchanged: true,
      lastModified: "2026-05-08T12:00:00.000Z",
    });
  });

  it("maps Notion permission and not-found errors into broken sources", async () => {
    const unauthorizedFetcher = new NotionPageFetcher({
      apiKey: "test-key",
      createClient: () =>
        createFakeNotionClient({
          pageError: new NotionProviderError({
            code: "unauthorized",
            message: "Forbidden",
            retryable: false,
          }),
        }),
    });
    const notFoundFetcher = new NotionPageFetcher({
      apiKey: "test-key",
      createClient: () =>
        createFakeNotionClient({
          pageError: new NotionProviderError({
            code: "not_found",
            message: "Missing",
            retryable: false,
          }),
        }),
    });

    await expect(
      unauthorizedFetcher.fetch({
        url: "https://www.notion.so/missing",
        sourceId: normalizeNotionId("cccccccccccccccccccccccccccccccc"),
        lastContentHash: null,
      }),
    ).resolves.toEqual({
      ok: false,
      status: "broken",
      error: "Permission denied when reading the Notion page.",
    });

    await expect(
      notFoundFetcher.fetch({
        url: "https://www.notion.so/missing",
        sourceId: normalizeNotionId("dddddddddddddddddddddddddddddddd"),
        lastContentHash: null,
      }),
    ).resolves.toEqual({
      ok: false,
      status: "broken",
      error: "Page not found in Notion.",
    });
  });

  it("fetches web pages, detects 304s, and classifies HTTP/network failures", async () => {
    const okFetcher = new WebPageFetcher({
      fetchImplementation: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({
          "last-modified": "Sat, 09 May 2026 12:00:00 GMT",
        }),
        text: () => Promise.resolve("<h1>Overview</h1><p>Volunteer help</p>"),
      } satisfies Partial<Response>),
    });
    const unchangedFetcher = new WebPageFetcher({
      fetchImplementation: vi.fn().mockResolvedValue({
        ok: false,
        status: 304,
        headers: new Headers(),
      } satisfies Partial<Response>),
    });
    const brokenFetcher = new WebPageFetcher({
      fetchImplementation: vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
      } satisfies Partial<Response>),
    });
    const thrownFetcher = new WebPageFetcher({
      fetchImplementation: vi
        .fn()
        .mockRejectedValue(new Error("socket hang up")),
    });

    await expect(
      okFetcher.fetch({
        url: "https://example.test/project",
        sourceId: "source:web",
        lastContentHash: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      unchanged: false,
      content: "Overview\n Volunteer help",
    });

    await expect(
      unchangedFetcher.fetch({
        url: "https://example.test/project",
        sourceId: "source:web",
        lastContentHash: null,
        lastModified: "Sat, 09 May 2026 11:00:00 GMT",
      }),
    ).resolves.toEqual({
      ok: true,
      unchanged: true,
      lastModified: "Sat, 09 May 2026 11:00:00 GMT",
    });

    await expect(
      brokenFetcher.fetch({
        url: "https://example.test/project",
        sourceId: "source:web",
        lastContentHash: null,
      }),
    ).resolves.toEqual({
      ok: false,
      status: "broken",
      error: "HTTP 404",
    });

    await expect(
      thrownFetcher.fetch({
        url: "https://example.test/project",
        sourceId: "source:web",
        lastContentHash: null,
      }),
    ).resolves.toEqual({
      ok: false,
      status: "broken",
      error: "socket hang up",
    });
  });

  it("times out slow web fetches", async () => {
    vi.useFakeTimers();

    try {
      const hangingFetch: typeof fetch = (_input, init) => {
        const signal = init?.signal;

        return new Promise<Response>((_, reject) => {
          signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      };
      const fetcher = new WebPageFetcher({
        timeoutMs: 15_000,
        fetchImplementation: hangingFetch,
      });

      const promise = fetcher.fetch({
        url: "https://example.test/slow",
        sourceId: "source:web",
        lastContentHash: null,
      });

      await vi.runAllTimersAsync();

      await expect(promise).resolves.toEqual({
        ok: false,
        status: "broken",
        error: "Timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns inline text verbatim with a content hash", async () => {
    const fetcher = new InlineTextFetcher();

    await expect(
      fetcher.fetch({
        url: "Operator note one\nOperator note two",
        sourceId: null,
        lastContentHash: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      unchanged: false,
      content: "Operator note one\nOperator note two",
      lastModified: null,
    });
  });
});
