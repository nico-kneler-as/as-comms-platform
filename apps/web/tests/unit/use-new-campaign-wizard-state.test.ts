import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/broadcasts/_lib/audience-data-source", () => ({
  loadComposePreviewAction: vi.fn(),
  loadMemberStatusCountsForProjects: vi.fn(),
  loadSelectedAliasSignatureAction: vi.fn(),
  loadSmsCsvAudienceSummaryAction: vi.fn(),
  previewAudienceAction: vi.fn(),
  resolveAudienceCountAction: vi.fn(),
  searchProjectVolunteersAction: vi.fn(),
}));

vi.mock("../../app/broadcasts/actions", () => ({
  previewSmsBroadcast: vi.fn(),
}));

import {
  designJsonFingerprint,
  normalizeCriteriaForFingerprint,
  readAllowedAudienceModesForSenderType,
} from "../../app/broadcasts/new/_components/use-new-campaign-wizard-state";

describe("use-new-campaign-wizard-state audience mode gating", () => {
  it("offers CSV upload to both org and project email senders", () => {
    expect(
      readAllowedAudienceModesForSenderType("org", "normal_email"),
    ).toEqual([
      "specific",
      "all_available",
      "csv_upload",
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
      "csv_upload",
    ]);
  });
});

describe("use-new-campaign-wizard-state saved-draft fingerprint", () => {
  const onScreen = {
    projectId: null,
    projectIds: [],
    statuses: [],
    expeditionIds: [],
    lastActivityWindow: "all_time" as const,
    hasReplied: "either" as const,
    hasClicked: "either" as const,
    initialFilter: "all_available" as const,
    exclusions: {
      previousRuns: [{ runId: "run-sept", audience: "openers" as const }],
      useUploadedExclusions: false,
      salesforceListIds: [],
    },
  };

  it("treats the server's echo of the same criteria as saved", () => {
    // The server fills defaults and returns keys in schema order.
    const fromServer = {
      hasClicked: "either" as const,
      projectIds: [],
      salesforceListIds: [],
      exclusions: {
        salesforceListIds: [],
        useUploadedExclusions: false,
        previousRuns: [{ audience: "openers" as const, runId: "run-sept" }],
      },
      statuses: [],
      expeditionIds: [],
      lastActivityWindow: "all_time" as const,
      hasReplied: "either" as const,
      projectId: null,
      initialFilter: "all_available" as const,
    };

    expect(JSON.stringify(normalizeCriteriaForFingerprint(fromServer))).toBe(
      JSON.stringify(normalizeCriteriaForFingerprint(onScreen)),
    );
  });

  it("still notices a real exclusion change", () => {
    const changed = {
      ...onScreen,
      exclusions: {
        ...onScreen.exclusions,
        previousRuns: [{ runId: "run-sept", audience: "recipients" as const }],
      },
    };

    expect(JSON.stringify(normalizeCriteriaForFingerprint(changed))).not.toBe(
      JSON.stringify(normalizeCriteriaForFingerprint(onScreen)),
    );
  });

  it("ignores the key order Postgres gives back for an email design", () => {
    expect(designJsonFingerprint({ body: { rows: [] }, counters: { u_row: 1 } })).toBe(
      designJsonFingerprint({ counters: { u_row: 1 }, body: { rows: [] } }),
    );
    expect(designJsonFingerprint(null)).toBe("null");
    expect(designJsonFingerprint(undefined)).toBe("null");
  });
});
