import { describe, expect, it } from "vitest";

import {
  buildBroadcastPreheaderHtml,
  buildBroadcastSignatureBlock,
  buildPostmarkUnsubscribePlaceholderHtml,
  buildBroadcastUnsubscribeUrls,
  formatBroadcastFromHeader,
} from "../src/broadcast-email-render.js";

describe("broadcast-email-render helpers", () => {
  it("formats a friendly From header with the project alias when present", () => {
    expect(
      formatBroadcastFromHeader(
        "pnwbio@adventurescientists.org",
        "PNW Biodiversity",
      ),
    ).toBe(
      '"Adventure Scientists – PNW Biodiversity" <pnwbio@adventurescientists.org>',
    );
  });

  it("falls back to the org name when no project alias exists", () => {
    expect(
      formatBroadcastFromHeader("news@adventurescientists.org", null),
    ).toBe('"Adventure Scientists" <news@adventurescientists.org>');
  });

  it("injects a hidden preheader and escapes HTML-sensitive characters", () => {
    expect(buildBroadcastPreheaderHtml("  Fish & <Forest>  ")).toBe(
      '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:transparent;font-size:1px;line-height:1px;">Fish &amp; &lt;Forest&gt;</div>',
    );
  });

  it("returns an empty preheader wrapper for blank values", () => {
    expect(buildBroadcastPreheaderHtml("   ")).toBe("");
    expect(buildBroadcastPreheaderHtml(null)).toBe("");
  });

  it("builds the hidden Postmark unsubscribe placeholder wrapper", () => {
    expect(buildPostmarkUnsubscribePlaceholderHtml()).toBe(
      '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:transparent;font-size:1px;line-height:1px;">{{{ pm:unsubscribe }}}</div>',
    );
  });

  it("builds a trimmed signature block for both text and html", () => {
    expect(
      buildBroadcastSignatureBlock("  Thanks,\nThe <AS> Team  "),
    ).toEqual({
      text: "Thanks,\nThe <AS> Team",
      html: '<p style="margin:16px 0;color:#0f172a;font-size:14px;line-height:1.6;">Thanks,<br>The &lt;AS&gt; Team</p>',
    });
  });

  it("skips empty signature blocks", () => {
    expect(buildBroadcastSignatureBlock("   ")).toEqual({
      text: "",
      html: "",
    });
    expect(buildBroadcastSignatureBlock(null)).toEqual({
      text: "",
      html: "",
    });
  });

  it("builds scoped and all unsubscribe URLs from the app origin", () => {
    expect(
      buildBroadcastUnsubscribeUrls({
        appUrl: "https://as.example.org/",
        unsubscribeToken: "token/with spaces",
      }),
    ).toEqual({
      scopedHref: "https://as.example.org/u/token%2Fwith%20spaces",
      allHref: "https://as.example.org/u/token%2Fwith%20spaces/all",
    });
  });
});
