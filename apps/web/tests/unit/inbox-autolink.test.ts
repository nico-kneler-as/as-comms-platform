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

  it("renders markdown-style links with only the label visible", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "p",
        null,
        autolinkText("Open [Field packet](https://example.org/forms)."),
      ),
    );

    expect(markup).toContain('href="https://example.org/forms"');
    expect(markup).toContain(">Field packet<");
    expect(markup).not.toContain("[Field packet]");
    expect(markup).not.toContain("(https://example.org/forms)");
  });

  it("renders parenthesized URLs as inline links when link text is present", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "p",
        null,
        autolinkText("Field packet (https://example.org/forms)"),
      ),
    );

    expect(markup).toContain('href="https://example.org/forms"');
    expect(markup).toContain(">Field packet<");
    expect(markup).not.toContain("(https://example.org/forms)");
  });

  it("uses the closest natural boundary for long lead-ins before parenthetical URLs", () => {
    const body =
      "Thank you so much for registering for the project webinar. In case you missed it or want to replay the action, you canaccess the recording here (https://vimeo.com/1143593967?share=copy&fl=sv&fe=ci) .";
    const markup = renderToStaticMarkup(
      createElement("p", null, autolinkText(body)),
    );

    expect(
      markup.match(
        /href="https:\/\/vimeo\.com\/1143593967\?share=copy&amp;fl=sv&amp;fe=ci"/g,
      ),
    ).toHaveLength(1);
    expect(markup).toContain(">you canaccess the recording here<");
    expect(markup).not.toContain("(https://vimeo.com");
    expect(markup).toContain("</a> .");
  });

  it("keeps question-mark sentence boundaries working for parenthetical URLs", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "p",
        null,
        autolinkText(
          "Need more background information on the project? Watch the webinar (https://example.org/wb)",
        ),
      ),
    );

    expect(markup).toContain('href="https://example.org/wb"');
    expect(markup).toContain(">Watch the webinar<");
    expect(markup).not.toContain("(https://example.org/wb)");
  });

  it("uses comma boundaries for parenthetical URLs", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "p",
        null,
        autolinkText(
          "Some long preamble that is well over eighty characters of unrelated lead-in copy, click the report (https://example.org/r) to view.",
        ),
      ),
    );

    expect(markup).toContain('href="https://example.org/r"');
    expect(markup).toContain(">click the report<");
    expect(markup).not.toContain("(https://example.org/r)");
    expect(markup).toContain("</a> to view.");
  });

  it("falls through to bare URLs when no boundary exists within the lookback window", () => {
    const body = `${"a".repeat(250)} (https://example.org/x)`;
    const markup = renderToStaticMarkup(
      createElement("p", null, autolinkText(body)),
    );

    expect(markup).toContain('href="https://example.org/x"');
    expect(markup).toContain(">https://example.org/x<");
    expect(markup).toContain("(<a");
    expect(markup).toContain("</a>)");
  });

  it("falls through to bare URLs when the parenthetical label is empty or whitespace-only", () => {
    const markup = renderToStaticMarkup(
      createElement("p", null, autolinkText("   (https://example.org/x)")),
    );

    expect(markup).toContain('href="https://example.org/x"');
    expect(markup).toContain(">https://example.org/x<");
    expect(markup).toContain("(<a");
    expect(markup).not.toContain("></a>");
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
