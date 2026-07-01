import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/broadcasts/_lib/audience-data-source", () => ({
  loadComposePreviewAction: vi.fn(),
  loadMemberStatusCountsForProjects: vi.fn(),
  loadSelectedAliasSignatureAction: vi.fn(),
  previewAudienceAction: vi.fn(),
  resolveAudienceCountAction: vi.fn(),
  searchProjectVolunteersAction: vi.fn(),
}));

import { readAllowedAudienceModesForSenderType } from "../../app/broadcasts/new/_components/use-new-campaign-wizard-state";

describe("use-new-campaign-wizard-state audience mode gating", () => {
  it("offers all_available only to org senders", () => {
    expect(readAllowedAudienceModesForSenderType("org")).toEqual([
      "specific",
      "all_available",
    ]);
    expect(readAllowedAudienceModesForSenderType("project")).toEqual([
      "project_status",
      "specific",
    ]);
  });
});
