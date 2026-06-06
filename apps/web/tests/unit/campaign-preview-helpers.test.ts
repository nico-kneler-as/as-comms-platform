import { describe, expect, it } from "vitest";

import { buildCampaignFooterPreview } from "../../app/broadcasts/_lib/campaign-preview";

describe("buildCampaignFooterPreview", () => {
  it("uses the project alias in the scoped unsubscribe label when available", () => {
    const footer = buildCampaignFooterPreview({
      kind: "project",
      projectName: "Passive Acoustic Monitoring of Pacific Northwest Forests",
      projectAlias: "PNW Biodiversity",
      footerAddress: null,
      origin: "https://as.example.org",
    });

    expect(footer.html).toContain("Unsubscribe from PNW Biodiversity emails");
    expect(footer.text).toContain("Unsubscribe from PNW Biodiversity emails");
    expect(footer.html.match(/\{\{\{ pm:unsubscribe \}\}\}/gu)).toHaveLength(1);
  });

  it("falls back to the project name when there is no alias", () => {
    const footer = buildCampaignFooterPreview({
      kind: "project",
      projectName: "Beech Leaf Disease",
      projectAlias: null,
      footerAddress: null,
      origin: "https://as.example.org",
    });

    expect(footer.html).toContain("Unsubscribe from Beech Leaf Disease emails");
    expect(footer.text).toContain("Unsubscribe from Beech Leaf Disease emails");
  });
});
