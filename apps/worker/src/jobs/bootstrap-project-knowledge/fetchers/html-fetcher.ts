import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type ReadabilityConstructor = new (document: unknown) => {
  parse(): {
    readonly title?: string | null;
    readonly textContent?: string | null;
  } | null;
};

type JsdomConstructor = new (
  html: string,
  options: { readonly url: string },
) => {
  readonly window: {
    readonly document: {
      readonly title?: string;
      readonly body?: { readonly textContent?: string | null } | null;
      cloneNode(deep?: boolean): unknown;
    };
  };
};

export interface ExtractedHtmlContent {
  readonly title: string | null;
  readonly markdown: string;
  readonly wordCount: number;
}

export interface HtmlFetchOptions {
  readonly fetchImplementation?: typeof fetch;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function countWords(value: string): number {
  const normalized = normalizeWhitespace(value);
  if (normalized.length === 0) {
    return 0;
  }

  return normalized.split(/\s+/u).length;
}

function tryLoadReadabilityStack():
  | {
      readonly Readability: ReadabilityConstructor;
      readonly JSDOM: JsdomConstructor;
    }
  | null {
  try {
    const readabilityModule = require("@mozilla/readability") as {
      readonly Readability?: ReadabilityConstructor;
    };
    const jsdomModule = require("jsdom") as {
      readonly JSDOM?: JsdomConstructor;
    };

    if (
      readabilityModule.Readability === undefined ||
      jsdomModule.JSDOM === undefined
    ) {
      return null;
    }

    return {
      Readability: readabilityModule.Readability,
      JSDOM: jsdomModule.JSDOM,
    };
  } catch {
    return null;
  }
}

function textFromDocument(document: {
  readonly body?: { readonly textContent?: string | null } | null;
}): string {
  const bodyText = document.body?.textContent ?? "";
  return normalizeWhitespace(bodyText);
}

export async function fetchAndExtract(
  url: string,
  options?: HtmlFetchOptions,
): Promise<ExtractedHtmlContent> {
  const fetchImplementation = options?.fetchImplementation ?? fetch;
  const response = await fetchImplementation(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
      "user-agent": "as-comms-platform/1.0 knowledge-bootstrap",
    },
  });

  if (!response.ok) {
    throw new Error(
      `HTML fetch failed for ${url} with status ${String(response.status)}.`,
    );
  }

  const html = await response.text();
  if (normalizeWhitespace(html).length === 0) {
    return {
      title: null,
      markdown: "",
      wordCount: 0,
    };
  }

  const readabilityStack = tryLoadReadabilityStack();
  if (readabilityStack === null) {
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html);
    const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/iu.exec(html);
    const rawText = bodyMatch?.[1] ?? html;
    const markdown = normalizeWhitespace(
      rawText
        .replace(/<script[\s\S]*?<\/script>/giu, " ")
        .replace(/<style[\s\S]*?<\/style>/giu, " ")
        .replace(/<[^>]+>/gu, " "),
    );

    return {
      title: titleMatch?.[1] === undefined ? null : normalizeWhitespace(titleMatch[1]),
      markdown,
      wordCount: countWords(markdown),
    };
  }

  const dom = new readabilityStack.JSDOM(html, {
    url,
  });
  const document = dom.window.document;
  const fallbackTitle = normalizeWhitespace(document.title ?? "");
  const fallbackText = textFromDocument(document);
  const article = new readabilityStack.Readability(document.cloneNode(true)).parse();
  const articleText = normalizeWhitespace(article?.textContent ?? "");
  const markdown = articleText.length > 0 ? articleText : fallbackText;
  const articleTitle = normalizeWhitespace(article?.title ?? "");
  const title =
    articleTitle.length > 0
      ? articleTitle
      : fallbackTitle.length > 0
        ? fallbackTitle
        : null;

  return {
    title,
    markdown,
    wordCount: countWords(markdown),
  };
}
