import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/broadcasts/_lib/audience-data-source", () => ({
  loadComposePreviewAction: vi.fn(),
  loadMemberStatusCountsForProjects: vi.fn(),
  loadSelectedAliasSignatureAction: vi.fn(),
  previewAudienceAction: vi.fn(),
  resolveAudienceCountAction: vi.fn(),
  searchProjectVolunteersAction: vi.fn(),
}));

vi.mock("../../app/broadcasts/actions", () => ({
  previewSmsBroadcast: vi.fn(),
}));

import { readAllowedAudienceModesForSenderType } from "../../app/broadcasts/new/_components/use-new-campaign-wizard-state";

describe("use-new-campaign-wizard-state audience mode gating", () => {
  it("offers CSV upload only to project email senders", () => {
    expect(
      readAllowedAudienceModesForSenderType("org", "normal_email"),
    ).toEqual([
      "specific",
      "all_available",
    ]);
    expect(
      readAllowedAudienceModesForSenderType("project", "normal_email"),
    ).toEqual([
      "project_status",
      "specific",
      "csv_upload",
    ]);
    expect(readAllowedAudienceModesForSenderType("project", "sms")).toEqual([
      "project_status",
      "specific",
    ]);
  });
});
