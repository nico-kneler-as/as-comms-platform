import { describe, expect, it } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

Object.assign(globalThis, { React });

import { autolinkText } from "../../app/inbox/_components/_autolink";

describe("autolinkText", () => {
  it("links a URL in the middle of text", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "p",
        null,
        autolinkText(
          "Review the packet at https://example.org/forms before tomorrow.",
          "text-sky-600",
        ),
      ),
    );

    expect(markup).toContain('href="https://example.org/forms"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain(">https://example.org/forms<");
  });

  it("links multiple URLs in one body", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "p",
        null,
        autolinkText(
          "Open https://example.org/a and then https://example.org/b for the two checklists.",
          "text-sky-600",
        ),
      ),
    );

    expect(markup.match(/href=/g)).toHaveLength(2);
    expect(markup).toContain('href="https://example.org/a"');
    expect(markup).toContain('href="https://example.org/b"');
  });

  it("keeps query strings and fragments in the linked URL", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "p",
        null,
        autolinkText(
          "Sign here: https://docuseal.com/e/abc123?review=true#signature",
          "text-sky-600",
        ),
      ),
    );

    expect(markup).toContain(
      'href="https://docuseal.com/e/abc123?review=true#signature"',
    );
  });

  it("keeps trailing punctuation outside the linked URL", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "p",
        null,
        autolinkText(
          "Review https://example.org/forms). before you reply.",
          "text-sky-600",
        ),
      ),
    );

    expect(markup).toContain('href="https://example.org/forms"');
    expect(markup).toContain(">https://example.org/forms<");
    expect(markup).toContain("</a>). before you reply.");
  });
});
