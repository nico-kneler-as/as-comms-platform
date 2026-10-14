import { describe, expect, it, vi } from "vitest";

import type { CampaignRunRecord } from "@as-comms/contracts";

import { createCampaignResendTask } from "../src/jobs/campaign-resend/index.js";

function run(input: {
  readonly id: string;
  readonly state: CampaignRunRecord["state"];
  readonly resendOfRunId?: string | null;
}): CampaignRunRecord {
  return {
    id: input.id, kind: "newsletter", launchType: "normal_email", state: input.state,
    projectId: null, name: null, fromEmail: "donate@example.org", fromName: "AS",
    replyToEmail: null, subjectTemplate: "Subject", subjectTemplateB: null,
    abTestEnabled: false, bodyHtmlTemplate: "<p>Body</p>", bodyDesignJson: null,
    bodyTextTemplate: "Body", preheader: null, audienceCriteria: {
      projectId: null, projectIds: [], statuses: [], contactIds: [], newsletterSubscriberIds: [],
      expeditionIds: [], lastActivityWindow: "all_time", hasReplied: "either", hasClicked: "either",
    }, audienceSize: null,
    resendOfRunId: input.resendOfRunId ?? null, resendDelayDays: input.resendOfRunId === undefined ? null : 3,
    scheduledAt: null, startedAt: null, completedAt: null, finalizedAt: null,
    cancelledAt: null, cancelledReason: null, createdByUserId: null, lastEditedByUserId: null,
    createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z",
  };
}

describe("campaign-resend worker task", () => {
  it("freezes quiet parent recipients through current consent and enqueues campaign-send", async () => {
    const parent = run({ id: "parent", state: "complete" });
    const child = run({ id: "child", state: "draft", resendOfRunId: parent.id });
    const freezeWithAudience = vi.fn().mockResolvedValue({ audienceSize: 1 });
    const addJob = vi.fn().mockResolvedValue(undefined);
    const append = vi.fn().mockResolvedValue({});
    const task = createCampaignResendTask({
      campaignRuns: { findById: vi.fn((id: string) => Promise.resolve(id === child.id ? child : parent)) },
      audienceSnapshots: { listForRun: vi.fn().mockResolvedValue([{
        id: "quiet", campaignRunId: parent.id, contactId: "contact-quiet", newsletterSubscriberId: null,
        frozenEmail: "quiet@example.org", frozenFirstName: "Quiet", frozenProjectName: null, frozenProjectId: null,
        frozenAliasEmail: null, unsubscribeToken: "token", subjectVariant: null, deliveryStatus: "sent",
        providerMessageId: null, sentAt: null, deliveredAt: null, bouncedAt: null, openedAt: null, clickedAt: null,
        complainedAt: null, unsubscribedAt: null, lastEventAt: null, createdAt: "2026-10-14T00:00:00.000Z",
      }]) },
      audienceComposition: { openedSnapshotIdsForRun: vi.fn().mockResolvedValue([]), clickedSnapshotIdsForRun: vi.fn().mockResolvedValue([]) },
      orchestrator: { freezeWithAudience, freeze: vi.fn(), preview: vi.fn(), processSendRequest: vi.fn(), cancel: vi.fn() },
      auditEvidence: { append },
    });

    await task({ childRunId: child.id }, { addJob } as never);
    expect(freezeWithAudience).toHaveBeenCalledWith(child.id, [expect.objectContaining({ frozenEmail: "quiet@example.org" })], expect.any(Date));
    expect(addJob).toHaveBeenCalledWith("campaign-send", { runId: child.id }, expect.objectContaining({ jobKey: `campaign-send:${child.id}` }));
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ action: "campaign_run.resend_fired" }));
  });

  it("does nothing for a cancelled child or incomplete parent", async () => {
    const freezeWithAudience = vi.fn();
    const child = run({ id: "child", state: "cancelled", resendOfRunId: "parent" });
    const task = createCampaignResendTask({
      campaignRuns: { findById: vi.fn().mockResolvedValue(child) },
      audienceSnapshots: { listForRun: vi.fn() },
      audienceComposition: { openedSnapshotIdsForRun: vi.fn(), clickedSnapshotIdsForRun: vi.fn() },
      orchestrator: { freezeWithAudience, freeze: vi.fn(), preview: vi.fn(), processSendRequest: vi.fn(), cancel: vi.fn() },
      auditEvidence: { append: vi.fn() },
    });
    await task({ childRunId: child.id }, { addJob: vi.fn() } as never);
    expect(freezeWithAudience).not.toHaveBeenCalled();
  });
});
