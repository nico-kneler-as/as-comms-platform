import { describe, expect, it } from "vitest";

import type { CampaignRunRecord } from "@as-comms/contracts";

import { readConfiguredResend } from "../../src/server/campaigns/configured-resend";

function child(overrides: Partial<CampaignRunRecord>): CampaignRunRecord {
  return {
    id: "child",
    workspace: "donors",
    kind: "newsletter",
    launchType: "html_email",
    state: "draft",
    projectId: null,
    name: "Resend: Year-end ask",
    fromEmail: "donate@example.org",
    fromName: "Adventure Scientists",
    replyToEmail: "donate@example.org",
    subjectTemplate: "Did you see this?",
    subjectTemplateB: null,
    abTestEnabled: false,
    bodyHtmlTemplate: "<p>Hi</p>",
    bodyDesignJson: null,
    bodyTextTemplate: "Hi",
    preheader: "One more day",
    audienceCriteria: {
      projectId: null,
      projectIds: [],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: null,
    resendOfRunId: "parent",
    resendDelayDays: 4,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    finalizedAt: null,
    cancelledAt: null,
    cancelledReason: null,
    createdByUserId: null,
    lastEditedByUserId: null,
    createdAt: "2026-10-14T12:00:00.000Z",
    updatedAt: "2026-10-14T12:00:00.000Z",
    ...overrides,
  } as CampaignRunRecord;
}

function repo(record: CampaignRunRecord | null) {
  return { findResendByParentRunId: () => Promise.resolve(record) };
}

describe("readConfiguredResend", () => {
  it("returns a pending reminder so a reopened draft keeps it", async () => {
    await expect(readConfiguredResend(repo(child({})), "parent")).resolves.toEqual({
      delayDays: 4,
      subject: "Did you see this?",
      preheader: "One more day",
    });
  });

  it("ignores cancelled reminders and drafts without one", async () => {
    await expect(readConfiguredResend(repo(child({ state: "cancelled" })), "parent")).resolves.toBeNull();
    await expect(readConfiguredResend(repo(null), "parent")).resolves.toBeNull();
  });
});
