import { describe, expect, it } from "vitest";

import {
  AutomatedEmailRenderError,
  renderAutomatedEmail,
  type AutomatedEmailRenderInput,
} from "../src/automated-email-render.js";

const baseInput: AutomatedEmailRenderInput = {
  subjectTemplate: "Update for {{firstName}}",
  bodyDoc: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
  },
  values: { firstName: "Taylor" },
  frame: {
    projectName: "PNW Bio",
    reasonLine: "You're receiving this because you applied to PNW Bio.",
  },
};

function expectRenderError(
  input: AutomatedEmailRenderInput,
  code: AutomatedEmailRenderError["code"],
  offender: string,
): void {
  try {
    renderAutomatedEmail(input);
    throw new Error("Expected renderAutomatedEmail to throw.");
  } catch (error) {
    expect(error).toBeInstanceOf(AutomatedEmailRenderError);
    expect(error).toMatchObject({ code, offender });
  }
}

describe("renderAutomatedEmail", () => {
  it("renders escaped paragraphs and inline styles for supported marks", () => {
    const result = renderAutomatedEmail({
      ...baseInput,
      bodyDoc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "<Hello> & " },
              { type: "text", text: "bold", marks: [{ type: "bold" }] },
              { type: "text", text: " and ", marks: [{ type: "italic" }] },
              {
                type: "text",
                text: "a link",
                marks: [{ type: "link", attrs: { href: "https://example.com/?a=1&b=2" } }],
              },
            ],
          },
        ],
      },
    });

    expect(result.html).toContain('<p style="margin:0 0 16px;">&lt;Hello&gt; &amp; ');
    expect(result.html).toContain('<strong style="font-weight:700;">bold</strong>');
    expect(result.html).toContain('<em style="font-style:italic;"> and </em>');
    expect(result.html).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(result.html).not.toContain('target="_blank"');
    expect(result.text).toContain("<Hello> & bold and a link (https://example.com/?a=1&b=2)");
  });

  it("renders nested bullet and ordered lists plus hard breaks", () => {
    const result = renderAutomatedEmail({
      ...baseInput,
      bodyDoc: {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Parent" }] },
                  {
                    type: "orderedList",
                    content: [
                      {
                        type: "listItem",
                        content: [{ type: "paragraph", content: [{ type: "text", text: "Nested" }] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Line one" }, { type: "hardBreak" }, { type: "text", text: "Line two" }],
          },
        ],
      },
    });

    expect(result.html).toContain('<ul style="margin:0 0 16px;padding-left:24px;">');
    expect(result.html).toContain('<ol style="margin:0 0 16px;padding-left:24px;">');
    expect(result.html).toContain("Line one<br>Line two");
    expect(result.text).toContain("- Parent\n  1. Nested");
    expect(result.text).toContain("Line one\nLine two");
  });

  it("HTML-escapes merge pills while preserving their raw value in text", () => {
    const result = renderAutomatedEmail({
      ...baseInput,
      bodyDoc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "mergeField", attrs: { key: "firstName" } }] }],
      },
      values: { firstName: "<script>alert('xss')</script>" },
    });

    expect(result.html).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
    expect(result.html).not.toContain("<script>");
    expect(result.text).toContain("<script>alert('xss')</script>");
  });

  it("substitutes subject tokens and rejects unknown or malformed tokens", () => {
    expect(renderAutomatedEmail(baseInput).subject).toBe("Update for Taylor");
    expectRenderError(
      { ...baseInput, subjectTemplate: "Hi {{lastName}}" },
      "unknown_token",
      "lastName",
    );
    expectRenderError(
      { ...baseInput, subjectTemplate: "Hi {{firstName" },
      "malformed_token",
      "Hi {{firstName",
    );
  });

  it("rejects unsupported nodes, marks, unsafe links, and missing values with typed errors", () => {
    expectRenderError(
      { ...baseInput, bodyDoc: { type: "doc", content: [{ type: "image" }] } },
      "unsupported_node",
      "image",
    );
    expectRenderError(
      {
        ...baseInput,
        bodyDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Nope", marks: [{ type: "underline" }] }] }] },
      },
      "unsupported_mark",
      "underline",
    );
    expectRenderError(
      {
        ...baseInput,
        bodyDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Nope", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] },
      },
      "invalid_link",
      "javascript:alert(1)",
    );
    expectRenderError(
      {
        ...baseInput,
        bodyDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "mergeField", attrs: { key: "missing" } }] }] },
      },
      "missing_value",
      "missing",
    );
  });

  it("uses the fixed transactional frame without external resources", () => {
    const result = renderAutomatedEmail({
      ...baseInput,
      frame: { projectName: "PNW <Bio>", reasonLine: "Reason & context" },
      bodyDoc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Read", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] }],
      },
    });
    const withoutBodyLinks = result.html.replace(/<a href="[^"]*"[^>]*>.*?<\/a>/gu, "");

    expect(result.html).toContain("Adventure Scientists · PNW &lt;Bio&gt;");
    expect(result.html).toContain("Reason &amp; context");
    expect(result.html).toContain("max-width:600px");
    expect(result.html).not.toContain("<img");
    expect(withoutBodyLinks).not.toMatch(/https?:\/\//u);
  });

  it("builds the complete text alternative from every supported node type", () => {
    const result = renderAutomatedEmail({
      ...baseInput,
      bodyDoc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello " },
              { type: "text", text: "bold", marks: [{ type: "bold" }] },
              { type: "text", text: " italic", marks: [{ type: "italic" }] },
              { type: "text", text: " site", marks: [{ type: "link", attrs: { href: "mailto:hello@example.com" } }] },
              { type: "hardBreak" },
              { type: "mergeField", attrs: { key: "firstName" } },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "First" }] },
                  {
                    type: "orderedList",
                    content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Nested" }] }] }],
                  },
                ],
              },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Second" }] }] },
            ],
          },
          {
            type: "orderedList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Two" }] }] },
            ],
          },
        ],
      },
    });

    expect(result.text).toBe(
      [
        "Adventure Scientists · PNW Bio",
        "Hello bold italic site (mailto:hello@example.com)\nTaylor\n\n- First\n  1. Nested\n- Second\n\n1. One\n2. Two",
        "Adventure Scientists",
        "You're receiving this because you applied to PNW Bio.",
      ].join("\n\n").replace("Adventure Scientists\n\nYou're", "Adventure Scientists\nYou're"),
    );
  });

  it("is deterministic for identical input", () => {
    expect(renderAutomatedEmail(baseInput)).toEqual(renderAutomatedEmail(baseInput));
  });
});
