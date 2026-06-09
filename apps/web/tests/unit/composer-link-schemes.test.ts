import { describe, expect, it } from "vitest";

import {
  COMPOSER_LINK_SCHEMES,
  isAllowedComposerLinkHref,
} from "../../src/lib/composer-link-schemes";

describe("composer link schemes", () => {
  it("exports the canonical accepted schemes", () => {
    expect(COMPOSER_LINK_SCHEMES).toEqual([
      "http",
      "https",
      "mailto",
      "sms",
      "tel",
    ]);
  });

  it("accepts the allowed href schemes", () => {
    expect(isAllowedComposerLinkHref("https://x.com")).toBe(true);
    expect(isAllowedComposerLinkHref("http://x.com")).toBe(true);
    expect(isAllowedComposerLinkHref("mailto:x@y.com")).toBe(true);
    expect(isAllowedComposerLinkHref("sms:+14062891988?body=START")).toBe(
      true,
    );
    expect(isAllowedComposerLinkHref("tel:+14062891988")).toBe(true);
  });

  it("rejects unsafe or unsupported href schemes", () => {
    expect(isAllowedComposerLinkHref("javascript:alert(1)")).toBe(false);
    expect(isAllowedComposerLinkHref("ftp://x.com")).toBe(false);
    expect(isAllowedComposerLinkHref("")).toBe(false);
    expect(isAllowedComposerLinkHref("   ")).toBe(false);
    expect(isAllowedComposerLinkHref("data:text/html,hi")).toBe(false);
    expect(isAllowedComposerLinkHref("file:///tmp/test")).toBe(false);
  });
});
