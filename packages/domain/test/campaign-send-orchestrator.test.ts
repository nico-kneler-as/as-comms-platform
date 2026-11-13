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

  it("freezes an audience list after applying a previous-run exclusion", async () => {
    const run: CampaignRunRecord = {
      ...buildRun("insiders"),
      audienceListId: "insiders",
      audienceCriteria: {
        ...buildRun("insiders").audienceCriteria,
        initialFilter: "audience_list",
        audienceListId: "insiders",
        salesforceListIds: [],
        exclusions: {
          salesforceListIds: [],
          useUploadedExclusions: false,
          previousRuns: [
            { runId: "previous-run", audience: "recipients" },
          ],
        },
      },
    };
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
          ensure: () =>
            Promise.resolve({ publicToken: "token", renderedHtml: null }),
          storeRendered: () => Promise.resolve(),
        },
      },
      audienceResolver: { resolveAudience: () => Promise.resolve([]) },
      resolveAudienceList: () =>
        Promise.resolve([
          {
            contactId: "contact-kept",
            newsletterSubscriberId: null,
            frozenEmail: "kept@example.org",
            frozenFirstName: "Kept",
            frozenProjectName: null,
            frozenProjectId: null,
            frozenAliasEmail: "info@example.org",
          },
          {
            contactId: "contact-previous",
            newsletterSubscriberId: null,
            frozenEmail: "previous@example.org",
            frozenFirstName: "Previous",
            frozenProjectName: null,
            frozenProjectId: null,
            frozenAliasEmail: "info@example.org",
          },
        ]),
      loadAudienceSets: () =>
        Promise.resolve({
          includeEmails: null,
          exclusions: [
            {
              reason: "previous_run_recipients",
              emails: new Set(["previous@example.org"]),
            },
          ],
        }),
      exclusionFilter: {
        applyExclusions: (members: readonly unknown[]) =>
          Promise.resolve({ eligible: members, excluded: [] }),
      },
      mergeRenderer: { render: () => ({ subject: "", html: "", text: "" }) },
      postmarkClient: { sendBatch: () => Promise.resolve({ results: [] }) },
      appUrl: "https://app.example.org",
    } as never);

    const result = await orchestrator.freeze(run.id, new Date());

    expect(result.excludedByReason).toEqual({
      previous_run_recipients: 1,
    });
    expect(snapshots[0]).toEqual([
      expect.objectContaining({ frozenEmail: "kept@example.org" }),
    ]);
  });

  it("uses the lists stream only for list runs", async () => {
    async function sendForRun(run: CampaignRunRecord) {
      let snapshot = {
        id: `snapshot-${run.id}`,
        campaignRunId: run.id,
        contactId: null,
        newsletterSubscriberId: null,
        frozenEmail: "recipient@example.org",
        frozenFirstName: "Recipient",
        frozenProjectName: null,
        frozenProjectId: null,
        frozenAliasEmail: "info@example.org",
        unsubscribeToken: "token",
        subjectVariant: null,
        deliveryStatus: "pending",
        providerMessageId: null,
        sentAt: null,
        deliveredAt: null,
        bouncedAt: null,
        openedAt: null,
        clickedAt: null,
        complainedAt: null,
        unsubscribedAt: null,
        lastEventAt: null,
        createdAt: "2026-11-12T12:00:00.000Z",
      };
      const sendBatch = vi.fn((input: {
        readonly messages: readonly {
          readonly MessageStream: string;
        }[];
      }) => {
        void input;
        return Promise.resolve({
          results: [
            {
              ErrorCode: 0,
              Message: "OK",
              MessageID: "message-1",
              SubmittedAt: "2026-11-12T12:01:00.000Z",
              To: snapshot.frozenEmail,
            },
          ],
        });
      });
      const orchestrator = createCampaignSendOrchestrator({
        repositories: {
          campaignRuns: {
            findById: () => Promise.resolve(run),
            transitionState: () => Promise.resolve(run),
            update: () => Promise.resolve(run),
          },
          audienceSnapshots: {
            bulkInsert: () => Promise.resolve(),
            listForRun: () => Promise.resolve([snapshot]),
            update: (_id: string, fields: Record<string, unknown>) => {
              snapshot = { ...snapshot, ...fields } as typeof snapshot;
              return Promise.resolve(snapshot);
            },
          },
          settingsProjects: { findById: () => Promise.resolve(null) },
          settingsAliases: { findByAlias: () => Promise.resolve(null) },
          audienceLists: {
            findById: () =>
              Promise.resolve({ id: "insiders", name: "Insiders" }),
          },
          orgSettings: {
            read: () =>
              Promise.resolve({
                physicalAddressLine1: "Adventure Scientists",
                physicalAddressLine2: "",
                physicalCity: "Bozeman",
                physicalState: "MT",
                physicalZip: "59715",
                physicalCountry: "USA",
              }),
          },
          broadcastWebVersions: {
            ensure: () =>
              Promise.resolve({ publicToken: "token", renderedHtml: null }),
            storeRendered: () => Promise.resolve(),
          },
        },
        audienceResolver: { resolveAudience: () => Promise.resolve([]) },
        exclusionFilter: {
          applyExclusions: (members: readonly unknown[]) =>
            Promise.resolve({ eligible: members, excluded: [] }),
        },
        mergeRenderer: {
          render: (message: { subject: string; bodyHtml: string; bodyText: string }) => ({
            subject: message.subject,
            html: message.bodyHtml,
            text: message.bodyText,
          }),
        },
        postmarkClient: { sendBatch },
        appUrl: "https://app.example.org",
        broadcastMessageStream: "broadcast",
        listMessageStream: "lists",
      } as never);

      await orchestrator.processSendRequest(run.id);
      return sendBatch.mock.calls[0]?.[0].messages[0]?.MessageStream;
    }

    const ordinaryRun: CampaignRunRecord = {
      ...buildRun("ordinary"),
      state: "sending",
      audienceListId: null,
      audienceCriteria: {
        ...buildRun("ordinary").audienceCriteria,
        initialFilter: "all_available",
        salesforceListIds: [],
      },
    };
    const listRun: CampaignRunRecord = {
      ...ordinaryRun,
      id: "run-list",
      audienceListId: "insiders",
      audienceCriteria: {
        ...ordinaryRun.audienceCriteria,
        initialFilter: "audience_list",
        audienceListId: "insiders",
      },
    };

    await expect(sendForRun(listRun)).resolves.toBe("lists");
    await expect(sendForRun(ordinaryRun)).resolves.toBe("broadcast");
  });
});
