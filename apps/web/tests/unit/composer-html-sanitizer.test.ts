import { describe, expect, it } from "vitest";

import {
  appendComposerHtmlSignature,
  plaintextToComposerHtml,
  sanitizeComposerHtml,
} from "../../src/lib/html-sanitizer";

describe("composer html sanitizer", () => {
  it("allows only the composer rich-text surface and strips unsafe attributes", () => {
    expect(
      sanitizeComposerHtml(
        '<p class="x">Hello <strong data-x="1">bold</strong> <em>italic</em> <a id="bad" href="https://example.org/path">link</a></p><script>alert(1)</script><style>p{color:red}</style><img src="x"><table><tr><td>cell</td></tr></table>',
      ),
    ).toBe(
      '<p>Hello <strong>bold</strong> <em>italic</em> <a href="https://example.org/path" class="text-sky-700 hover:underline" target="_blank" rel="noopener noreferrer">link</a></p><table><tr><td>cell</td></tr></table>',
    );
  });

  it("keeps safe email presentation tags without preserving attributes", () => {
    expect(sanitizeComposerHtml("<blockquote>quoted</blockquote>")).toBe(
      "<blockquote>quoted</blockquote>",
    );
    expect(sanitizeComposerHtml('<h2 data-x="1">Heading</h2>')).toBe(
      "<h2>Heading</h2>",
    );
    expect(
      sanitizeComposerHtml(
        '<div class="x"><span style="color:red">nested</span></div>',
      ),
    ).toBe("<div><span>nested</span></div>");
    expect(
      sanitizeComposerHtml(
        '<table class="x"><thead><tr><th>head</th></tr></thead><tbody><tr><td>cell</td></tr></tbody></table><hr data-x="1">',
      ),
    ).toBe(
      "<table><thead><tr><th>head</th></tr></thead><tbody><tr><td>cell</td></tr></tbody></table><hr>",
    );
  });

  it("removes unsafe link hrefs but keeps link text", () => {
    expect(
      sanitizeComposerHtml(
        '<p><a href="javascript:alert(1)" class="bad">Click me</a></p>',
      ),
    ).toBe("<p>Click me</p>");
  });

  it("strips unsafe tags and image tags without leaking image fallback text", () => {
    expect(sanitizeComposerHtml("<script>alert(1)</script><p>safe</p>")).toBe(
      "<p>safe</p>",
    );
    expect(
      sanitizeComposerHtml(
        '<p>before</p><img src="x" alt="leaked" onerror="alert(1)"><p>after</p>',
      ),
    ).toBe("<p>before</p><p>after</p>");
  });

  it("converts plaintext and appends signature html while keeping safe structure", () => {
    expect(
      appendComposerHtmlSignature({
        bodyHtml: '<p>Body <span style="color:red">copy</span></p>',
        bodyPlaintext: "Body copy",
        signaturePlaintext: "Adventure Scientists\nhttps://example.org",
      }),
    ).toBe(
      '<p>Body <span>copy</span></p><p>Adventure Scientists<br><a href="https://example.org" class="text-sky-700 hover:underline" target="_blank" rel="noopener noreferrer">https://example.org</a></p>',
    );

    expect(plaintextToComposerHtml("One\nTwo\n\nThree")).toBe(
      "<p>One<br>Two</p><p>Three</p>",
    );
  });

  it("keeps safe link attributes while rejecting scripts", () => {
    expect(
      sanitizeComposerHtml(
        '<p><a href="https://example.org" target="_self" rel="bad" onclick="alert(1)">Example</a><script>alert(1)</script></p>',
      ),
    ).toBe(
      '<p><a href="https://example.org" class="text-sky-700 hover:underline" target="_blank" rel="noopener noreferrer">Example</a></p>',
    );
  });
});
