import { describe, expect, it } from "vitest";

import {
  buildBroadcastPreheaderHtml,
  buildBroadcastSignatureBlock,
  buildBroadcastUnsubscribeFooter,
  buildPostmarkUnsubscribePlaceholderHtml,
  buildBroadcastUnsubscribeUrls,
  formatBroadcastFromHeader,
  renderBroadcastEmail,
  type BroadcastEmailRenderInput,
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

  it("builds the canonical unsubscribe footer", () => {
    const footer = buildBroadcastUnsubscribeFooter({
      kind: "project",
      projectName: "Passive Acoustic Monitoring of Pacific Northwest Forests",
      projectAlias: "PNW Biodiversity",
      footerAddress: null,
      scopedHref: "https://as.example.org/u/preview-project",
      allHref: "https://as.example.org/u/preview-project/all",
    });

    expect(footer.html).toContain("Unsubscribe from PNW Biodiversity emails");
    expect(footer.text).toContain("Unsubscribe from PNW Biodiversity emails");
    expect(footer.html.match(/\{\{\{ pm:unsubscribe \}\}\}/gu)).toHaveLength(1);
  });
});

describe("buildBroadcastSignatureBlock", () => {
  it("returns empty fields when signature is null or whitespace", () => {
    expect(buildBroadcastSignatureBlock(null)).toEqual({ text: "", html: "" });
    expect(buildBroadcastSignatureBlock("   \n  ")).toEqual({
      text: "",
      html: "",
    });
  });

  it("emits a paragraph without typography styles", () => {
    const { html } = buildBroadcastSignatureBlock("Cheers,\nNico");

    expect(html).not.toMatch(/font-size/i);
    expect(html).not.toMatch(/font-family/i);
    expect(html).not.toMatch(/color\s*:/i);
    expect(html).not.toMatch(/line-height/i);
    expect(html).toBe('<p style="margin-top:16px;">Cheers,<br>Nico</p>');
  });

  it("escapes HTML in the signature and preserves newlines as breaks", () => {
    const { html } = buildBroadcastSignatureBlock(
      "AS <Team>\nA & B\nhttps://example.org",
    );

    expect(html).toBe(
      '<p style="margin-top:16px;">AS &lt;Team&gt;<br>A &amp; B<br>https://example.org</p>',
    );
  });
});

describe("renderBroadcastEmail", () => {
  const baseInput: BroadcastEmailRenderInput = {
    kind: "project",
    projectName: "PNW Biodiversity",
    projectAlias: "PNW Biodiversity",
    footerAddress: "123 Main St • Bozeman, MT 59715",
    preheader: "Field season starts in 3 weeks",
    bodyHtmlTemplate: "<p>Hello {{firstName}},</p>",
    bodyTextTemplate: "Hello {{firstName}},",
    signature: "Cheers,\nThe AS Team",
    scopedUnsubscribeHref: "https://app.example.com/u/abc",
    allUnsubscribeHref: "https://app.example.com/u/abc/all",
    senderEmail: "pnwbio@adventurescientists.org",
  };

  it("composes the four parts in order", () => {
    const result = renderBroadcastEmail(baseInput);
    const preheaderIdx = result.bodyHtml.indexOf("Field season starts");
    const bodyIdx = result.bodyHtml.indexOf("Hello {{firstName}}");
    const signatureIdx = result.bodyHtml.indexOf("Cheers,");
    const footerIdx = result.bodyHtml.indexOf("Unsubscribe");

    expect(preheaderIdx).toBeGreaterThan(-1);
    expect(bodyIdx).toBeGreaterThan(preheaderIdx);
    expect(signatureIdx).toBeGreaterThan(bodyIdx);
    expect(footerIdx).toBeGreaterThan(signatureIdx);
  });

  it("emits the Adventure Scientists From header with the project alias", () => {
    expect(renderBroadcastEmail(baseInput).fromHeader).toBe(
      '"Adventure Scientists – PNW Biodiversity" <pnwbio@adventurescientists.org>',
    );
  });

  it("emits a List-Unsubscribe header value wrapping the scoped href", () => {
    expect(renderBroadcastEmail(baseInput).listUnsubscribeHeaderValue).toBe(
      "<https://app.example.com/u/abc>",
    );
  });

  it("omits the signature block when no signature is provided", () => {
    const result = renderBroadcastEmail({ ...baseInput, signature: null });

    expect(result.bodyHtml).not.toContain("margin-top:16px");
    expect(result.bodyText).toBe(
      [
        "Hello {{firstName}},",
        "Unsubscribe from PNW Biodiversity emails · Unsubscribe from all Adventure Scientists emails\nUnsubscribe from PNW Biodiversity emails: https://app.example.com/u/abc\nUnsubscribe from all Adventure Scientists emails: https://app.example.com/u/abc/all\n123 Main St • Bozeman, MT 59715",
      ].join("\n\n"),
    );
  });

  it("includes the hidden Postmark unsubscribe placeholder exactly once", () => {
    const { bodyHtml } = renderBroadcastEmail(baseInput);

    expect(bodyHtml.match(/\{\{\{ pm:unsubscribe \}\}\}/gu)).toHaveLength(1);
  });
});
