import { describe, expect, it } from "vitest";

import { createMergeRenderer } from "../src/merge-renderer.js";
import type { AudienceMember } from "../src/campaign-types.js";

const renderer = createMergeRenderer();

function buildMember(
  overrides: Partial<AudienceMember> = {},
): AudienceMember {
  return {
    contactId: "contact-1",
    newsletterSubscriberId: null,
    frozenEmail: "contact-1@example.org",
    frozenFirstName: "Taylor",
    frozenProjectName: "Forests",
    frozenProjectId: "project-1",
    frozenAliasEmail: "forests@example.org",
    ...overrides,
  };
}

describe("createMergeRenderer", () => {
  it("resolves each supported token", () => {
    const rendered = renderer.render(
      {
        subject: "Hi {{firstName}} from {{projectName}}",
        bodyHtml: "<p>{{firstName}} / {{projectName}} / {{aliasEmail}}</p>",
        bodyText: "{{firstName}} / {{projectName}} / {{aliasEmail}}",
      },
      {
        firstName: "Taylor",
        projectName: "Forests",
        aliasEmail: "forests@example.org",
        viewInBrowserUrl: null,
      },
    );

    expect(rendered).toEqual({
      subject: "Hi Taylor from Forests",
      html: "<p>Taylor / Forests / forests@example.org</p>",
      text: "Taylor / Forests / forests@example.org",
    });
  });

  it("renders viewInBrowser and never reports it as missing", () => {
    const rendered = renderer.render(
      {
        subject: "{{viewInBrowser}}",
        bodyHtml: "<a href=\"{{viewInBrowser}}\">link</a>",
        bodyText: "{{viewInBrowser}}",
      },
      {
        firstName: null,
        projectName: null,
        aliasEmail: null,
        viewInBrowserUrl: "https://app.example.test/b/token",
      },
    );

    expect(rendered.subject).toBe("https://app.example.test/b/token");
    expect(rendered.html).toContain("https://app.example.test/b/token");
    expect(rendered.text).toBe("https://app.example.test/b/token");
    expect(
      renderer.validateTokens(
        { subject: "{{viewInBrowser}}", bodyHtml: "{{viewInBrowser}}" },
        [buildMember()],
      ),
    ).toEqual({});
  });

  it("renders missing tokens as empty strings and reports them during validation", () => {
    const rendered = renderer.render(
      {
        subject: "Hi {{firstName}}",
        bodyHtml: "<p>{{firstName}}</p>",
        bodyText: "{{firstName}}",
      },
      {
        firstName: null,
        projectName: "Forests",
        aliasEmail: "forests@example.org",
        viewInBrowserUrl: null,
      },
    );

    expect(rendered).toEqual({
      subject: "Hi ",
      html: "<p></p>",
      text: "",
    });
    expect(
      renderer.validateTokens(
        {
          subject: "Hi {{firstName}}",
          bodyHtml: "<p>{{firstName}}</p>",
        },
        [buildMember({ frozenFirstName: null })],
      ),
    ).toEqual({
      "contact-1": ["firstName"],
    });
  });

  it("HTML-escapes merge values to prevent XSS while leaving text-body merges plain", () => {
    const xss = "<script>alert('xss')</script>";
    const rendered = renderer.render(
      {
        subject: "Hello {{firstName}}",
        bodyHtml: "<p>{{firstName}}</p>",
        bodyText: "{{firstName}}",
      },
      {
        firstName: xss,
        projectName: null,
        aliasEmail: null,
        viewInBrowserUrl: null,
      },
    );

    expect(rendered.subject).toBe(`Hello ${xss}`);
    expect(rendered.html).toBe(
      "<p>&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;</p>",
    );
    expect(rendered.text).toBe(xss);
  });

  it("reports malformed templates without crashing render", () => {
    expect(
      renderer.render(
        {
          subject: "Hello {{firstName",
          bodyHtml: "<p>{{firstName</p>",
          bodyText: "{{firstName",
        },
        {
          firstName: "Taylor",
          projectName: null,
          aliasEmail: null,
          viewInBrowserUrl: null,
        },
      ),
    ).toEqual({
      subject: "Hello {{firstName",
      html: "<p>{{firstName</p>",
      text: "{{firstName",
    });

    expect(
      renderer.validateTokens(
        {
          subject: "Hello {{firstName",
          bodyHtml: "<p>{{firstName</p>",
        },
        [buildMember()],
      ),
    ).toEqual({
      "contact-1": ["__malformed__"],
    });
  });

  it("merges plain text separately from HTML", () => {
    const rendered = renderer.render(
      {
        subject: "Update",
        bodyHtml: "<strong>{{projectName}}</strong>",
        bodyText: "* {{projectName}} *",
      },
      {
        firstName: null,
        projectName: "Rivers",
        aliasEmail: null,
        viewInBrowserUrl: null,
      },
    );

    expect(rendered.html).toBe("<strong>Rivers</strong>");
    expect(rendered.text).toBe("* Rivers *");
  });

  it("keys missing-token warnings by newsletter subscriber when no contact id exists", () => {
    expect(
      renderer.validateTokens(
        {
          subject: "Hi {{firstName}}",
          bodyHtml: "<p>{{firstName}}</p>",
        },
        [
          buildMember({
            contactId: null,
            newsletterSubscriberId: "subscriber-1",
            frozenFirstName: null,
          }),
        ],
      ),
    ).toEqual({
      "subscriber-1": ["firstName"],
    });
  });
});
