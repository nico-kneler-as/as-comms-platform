import { describe, expect, it, vi } from "vitest";

import type { CampaignRunRecord } from "@as-comms/contracts";

import { createCampaignSendOrchestrator } from "../src/campaign-send-orchestrator.js";

function buildRun(listId: string): CampaignRunRecord {
  return {
    id: `run-${listId}`,
    workspace: "volunteers",
    kind: "newsletter",
    launchType: "normal_email",
    state: "draft",
    projectId: null,
    name: "Insiders",
    fromEmail: "info@example.org",
    fromName: null,
    replyToEmail: "replies@example.org",
    subjectTemplate: "Hello",
    subjectTemplateB: null,
    abTestEnabled: false,
    bodyHtmlTemplate: "<p>Hello</p>",
    bodyDesignJson: null,
    bodyTextTemplate: "Hello",
    preheader: null,
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
      initialFilter: "salesforce_lists",
      salesforceListIds: [listId],
    },
    audienceSize: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    finalizedAt: null,
    cancelledAt: null,
    cancelledReason: null,
    createdByUserId: null,
    lastEditedByUserId: null,
    createdAt: "2026-11-10T12:00:00.000Z",
    updatedAt: "2026-11-10T12:00:00.000Z",
  };
}

function createOrchestrator(
  run: CampaignRunRecord,
  resolveStandingListAudience: ReturnType<typeof vi.fn>,
  resolveNewsletterAudience: ReturnType<typeof vi.fn>,
  includeEmails: ReadonlySet<string> | null,
) {
  const snapshots: unknown[][] = [];
  const orchestrator = createCampaignSendOrchestrator({
    repositories: {
      campaignRuns: {
        findById: () => Promise.resolve(run),
        transitionState: () => Promise.resolve(run),
        update: () => Promise.resolve(run),
      },
      audienceSnapshots: {
        bulkInsert: (_runId: string, members: readonly unknown[]) => {
          snapshots.push([...members]);
          return Promise.resolve();
        },
        listForRun: () => Promise.resolve([]),
        update: () => Promise.reject(new Error("not used by freeze")),
      },
      settingsProjects: { findById: () => Promise.resolve(null) },
      settingsAliases: { findByAlias: () => Promise.resolve(null) },
      orgSettings: { read: () => Promise.resolve({}) },
      broadcastWebVersions: {
        ensure: () => Promise.resolve({ publicToken: "token", renderedHtml: null }),
        storeRendered: () => Promise.resolve(),
      },
    },
    audienceResolver: { resolveAudience: () => Promise.resolve([]) },
    resolveNewsletterAudience,
    resolveStandingListAudience,
    loadAudienceSets: () => Promise.resolve({ includeEmails, exclusions: [] }),
    exclusionFilter: {
      applyExclusions: (members: readonly unknown[]) => Promise.resolve({
        eligible: members,
        excluded: [],
      }),
    },
    mergeRenderer: { render: () => ({ subject: "", html: "", text: "" }) },
    postmarkClient: { sendBatch: () => Promise.resolve({ results: [] }) },
    appUrl: "https://app.example.org",
  } as never);

  return { orchestrator, snapshots };
}

describe("campaign send orchestrator standing-list base", () => {
  it("freezes Insiders from the standing-list base and only falls back to newsletter subscribers for campaign lists", async () => {
    const resolveNewsletterAudience = vi.fn(() => Promise.resolve([
      {
        contactId: null,
        newsletterSubscriberId: "subscriber-1",
        frozenEmail: "newsletter@example.org",
        frozenFirstName: "Newsletter",
        frozenProjectName: null,
        frozenProjectId: null,
        frozenAliasEmail: null,
      },
    ]));
    const insiders = createOrchestrator(
      buildRun("insiders"),
      vi.fn(() => Promise.resolve([
        {
          email: "insider@example.org",
          newsletterSubscriberId: null,
          firstName: "Insider",
        },
      ])),
      resolveNewsletterAudience,
      new Set(["insider@example.org"]),
    );

    await insiders.orchestrator.freeze("run-insiders", new Date());

    expect(resolveNewsletterAudience).not.toHaveBeenCalled();
    expect(insiders.snapshots[0]).toEqual([
      expect.objectContaining({
        contactId: null,
        newsletterSubscriberId: null,
        frozenEmail: "insider@example.org",
        frozenFirstName: "Insider",
      }),
    ]);

    const campaign = createOrchestrator(
      buildRun("campaign:701"),
      vi.fn(() => Promise.resolve(null)),
      resolveNewsletterAudience,
      new Set(["newsletter@example.org"]),
    );

    await campaign.orchestrator.freeze("run-campaign:701", new Date());

    expect(resolveNewsletterAudience).toHaveBeenCalledTimes(1);
    expect(campaign.snapshots[0]).toEqual([
      expect.objectContaining({ frozenEmail: "newsletter@example.org" }),
    ]);
  });
});
