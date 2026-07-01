import { describe, expect, it } from "vitest";

import {
  BRAND_DEFAULT_STARTER,
  SOCIAL_LINKS_HTML,
} from "../../app/broadcasts/new/_components/unlayer-options";

describe("BRAND_DEFAULT_STARTER", () => {
  it("matches the AS newsletter shell structure", () => {
    expect(BRAND_DEFAULT_STARTER.schemaVersion).toBe(7);
    expect(BRAND_DEFAULT_STARTER.body.values.contentWidth).toBe("600px");
    expect(BRAND_DEFAULT_STARTER.body.values.backgroundColor).toBe("#F3F2EE");

    const rows = BRAND_DEFAULT_STARTER.body.rows;
    expect(rows).toHaveLength(4);

    expect(rows[0].columns[0].contents[0]).toMatchObject({
      id: "img-1",
      type: "image",
      values: {
        src: {
          url: "https://pub-30761e7e9d5048c8aca67da2bf45f892.r2.dev/mailchimp-import/6883086-beech-both.png",
        },
        size: { autoWidth: false, width: "600px" },
      },
    });

    expect(rows[1].columns[0].contents[0]).toMatchObject({
      id: "text-1",
      type: "text",
    });
    expect(rows[1].columns[0].contents[0].values.text).toContain(
      "Write your message here…",
    );

    expect(rows[2].columns[0].contents[0]).toMatchObject({
      id: "social-html-1",
      type: "html",
      values: {
        html: SOCIAL_LINKS_HTML,
      },
    });
    expect(SOCIAL_LINKS_HTML).toContain(
      "https://www.facebook.com/adventurescientists",
    );
    expect(SOCIAL_LINKS_HTML).toContain(
      "https://www.instagram.com/adventurescientists",
    );
    expect(SOCIAL_LINKS_HTML).toContain(
      "https://www.linkedin.com/company/adventure-scientists",
    );

    expect(rows[3].columns[0].contents[0]).toMatchObject({
      id: "footer-html-1",
      type: "html",
    });
  });
});
