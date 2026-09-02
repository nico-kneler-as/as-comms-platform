import { describe, expect, it } from "vitest";

import {
  buildBroadcastWebVersionUrl,
  renderBroadcastWebVersion,
} from "../src/broadcast-web-version-render.js";

const baseInput = {
  launchType: "normal_email" as const,
  kind: "project" as const,
  subject: "Hello {{firstName}} from {{projectName}}",
  bodyHtmlTemplate:
    "<p>Hi {{firstName}} — {{projectName}} — {{aliasEmail}} — <a href=\"{{viewInBrowser}}\">browser</a></p><!-- as-locked-footer-start --><p>locked</p><!-- as-locked-footer-end -->{{{ pm:unsubscribe }}}",
  projectName: "Forests <West>",
  projectAlias: "forests",
  senderEmail: "forests@example.org",
  signature: "Thanks\nAS <Team>",
  footerAddress: "1 Main & First",
  pageUrl: "https://app.example.test/b/a%2Fb",
  subscribeUrl: "https://www.adventurescientists.org/subscribe",
};

describe("broadcast web version rendering", () => {
  it("builds a normalized public URL", () => {
    expect(
      buildBroadcastWebVersionUrl({
        appUrl: "https://app.example.test///",
        token: "a/b c",
      }),
    ).toBe("https://app.example.test/b/a%2Fb%20c");
  });

  it("wraps a fragment in a complete, neutral document", () => {
    const rendered = renderBroadcastWebVersion(baseInput);

    expect(rendered.title).toBe("Hello friend from Forests <West>");
    expect(rendered.html).toContain("<!doctype html>");
    expect(rendered.html).toContain('<meta charset="utf-8">');
    expect(rendered.html).toContain('name="viewport"');
    expect(rendered.html).toContain("Hi friend");
    expect(rendered.html).toContain("Forests &lt;West&gt;");
    expect(rendered.html).toContain("AS &lt;Team&gt;");
    expect(rendered.html).toContain(baseInput.pageUrl);
    expect(rendered.html).not.toContain("locked");
    expect(rendered.html).not.toContain("pm:unsubscribe");
    expect(rendered.html).not.toContain("/u/");
    expect(rendered.html).not.toContain("display:none");
  });

  it("keeps a full document, replaces its title, and injects the footer before body close", () => {
    const rendered = renderBroadcastWebVersion({
      ...baseInput,
      launchType: "html_email",
      subject: "",
      bodyHtmlTemplate:
        '<html><head><title>Old</title></head><body><p>Hi {{firstName}}</p></body></html>',
    });

    expect(rendered.title).toBe("Adventure Scientists");
    expect(rendered.html).toContain("<html>");
    expect(rendered.html).toContain("<title>Adventure Scientists</title>");
    expect(rendered.html.indexOf("1 Main &amp; First")).toBeLessThan(
      rendered.html.indexOf("</body>"),
    );
    expect(rendered.html).toContain('name="viewport"');
    expect(rendered.html).not.toContain("margin-top:16px");
  });

  it("adds the newsletter subscribe link only for newsletters", () => {
    const newsletter = renderBroadcastWebVersion({
      ...baseInput,
      kind: "newsletter",
    });
    const project = renderBroadcastWebVersion(baseInput);

    expect(newsletter.html).toContain(
      "Subscribe to the Adventure Scientists newsletter",
    );
    expect(newsletter.html).toContain(baseInput.subscribeUrl);
    expect(project.html).not.toContain(
      "Subscribe to the Adventure Scientists newsletter",
    );
  });
});
