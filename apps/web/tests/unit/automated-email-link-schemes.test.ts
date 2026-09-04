import { renderAutomatedEmail } from "@as-comms/domain";
import { describe, expect, it } from "vitest";

import {
  AUTOMATED_EMAIL_LINK_SCHEMES,
  COMPOSER_LINK_SCHEMES,
  isAllowedAutomatedEmailLinkHref,
} from "../../src/lib/composer-link-schemes";

function rendersLink(href: string): boolean {
  try {
    renderAutomatedEmail({
      subjectTemplate: "Subject",
      bodyDoc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "go", marks: [{ type: "link", attrs: { href } }] },
            ],
          },
        ],
      },
      values: {},
      frame: { projectName: "Project", reasonLine: "reason" },
    });
    return true;
  } catch {
    return false;
  }
}

describe("automated email link schemes", () => {
  const samples: Readonly<Record<string, string>> = {
    http: "http://adventurescientists.org",
    https: "https://adventurescientists.org",
    mailto: "mailto:pnw@adventurescientists.org",
    sms: "sms:+14062891988",
    tel: "tel:+14062891988",
  };

  it("matches exactly what the renderer accepts", () => {
    // The editor must not let an operator insert a link the send pipeline will
    // reject — sms: and tel: are fine in the composer but not in an
    // automated email.
    for (const [scheme, href] of Object.entries(samples)) {
      expect(
        isAllowedAutomatedEmailLinkHref(href),
        `${scheme} editor acceptance should match the renderer`,
      ).toBe(rendersLink(href));
    }
  });

  it("is a strict subset of the composer's schemes", () => {
    for (const scheme of AUTOMATED_EMAIL_LINK_SCHEMES) {
      expect(COMPOSER_LINK_SCHEMES).toContain(scheme);
    }
    expect(AUTOMATED_EMAIL_LINK_SCHEMES.length).toBeLessThan(
      COMPOSER_LINK_SCHEMES.length,
    );
  });

  it("rejects a missing href instead of throwing", () => {
    expect(isAllowedAutomatedEmailLinkHref(null)).toBe(false);
    expect(isAllowedAutomatedEmailLinkHref(undefined)).toBe(false);
  });
});
