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
      '<p>Hello <strong>bold</strong> <em>italic</em> <a href="https://example.org/path">link</a></p>cell',
    );
  });

  it("removes unsafe link hrefs but keeps link text", () => {
    expect(
      sanitizeComposerHtml(
        '<p><a href="javascript:alert(1)" class="bad">Click me</a></p>',
      ),
    ).toBe("<p>Click me</p>");
  });

  it("converts plaintext and appends signature html without widening tags", () => {
    expect(
      appendComposerHtmlSignature({
        bodyHtml: '<p>Body <span style="color:red">copy</span></p>',
        bodyPlaintext: "Body copy",
        signaturePlaintext: "Adventure Scientists\nhttps://example.org",
      }),
    ).toBe(
      '<p>Body copy</p><p>Adventure Scientists<br><a href="https://example.org">https://example.org</a></p>',
    );

    expect(plaintextToComposerHtml("One\nTwo\n\nThree")).toBe(
      "<p>One<br>Two</p><p>Three</p>",
    );
  });
});
