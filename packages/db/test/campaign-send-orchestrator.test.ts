import { afterEach, describe, expect, it } from "vitest";

import type { CreateDraftInput } from "@as-comms/contracts";
import {
  createAudienceResolver,
  createCampaignSendOrchestrator,
  createExclusionFilter,
  createMergeRenderer,
} from "@as-comms/domain";

import { createStage5RepositoryBundle } from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

type Stage1Context = Awaited<ReturnType<typeof createTestStage1Context>>;

function buildAudienceCriteria(): CreateDraftInput["audienceCriteria"] {
  return {
    projectId: "project-1",
    projectIds: ["project-1"],
    statuses: ["Active"],
    contactIds: [],
    expeditionIds: [],
    lastActivityWindow: "all_time",
    hasReplied: "either",
    hasClicked: "either",
  };
}

function buildDraftInput(
  overrides: Partial<CreateDraftInput> = {},
): CreateDraftInput {
  return {
    id: "run-1",
    kind: "project",
    launchType: "normal_email",
    projectId: "project-1",
    name: null,
    fromEmail: null,
    fromName: null,
    replyToEmail: null,
    subjectTemplate: "Hello {{firstName}}",
    bodyHtmlTemplate: "<p>{{projectName}}</p>",
    bodyTextTemplate: "{{aliasEmail}}",
    preheader: null,
    audienceCriteria: buildAudienceCriteria(),
    audienceSize: null,
    createdByUserId: null,
    lastEditedByUserId: null,
    ...overrides,
  };
}

async function seedProject(context: Stage1Context) {
  await context.repositories.projectDimensions.upsert({
    projectId: "project-1",
    projectName: "Project One",
    projectAlias: "project-one",
    connectedToProjectId: null,
    source: "manual",
    isActive: true,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null,
    aiKnowledgeSources: [],
    aiOperatingContext: "",
    aiAutoSyncSchedule: "never",
    aiOptimizedSynthesizedAt: null,
    aiOptimizedInputHash: null,
  });
  await context.settings.aliases.create({
    id: "alias-project-1",
    alias: "project-one@example.org",
    signature: "",
    projectId: "project-1",
    createdAt: new Date("2026-05-15T12:00:00.000Z"),
    updatedAt: new Date("2026-05-15T12:00:00.000Z"),
    createdBy: null,
    updatedBy: null,
  });
}

async function seedAudience(
  context: Stage1Context,
  count: number,
): Promise<string[]> {
  const contactIds: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const contactId = `contact-${String(index + 1).padStart(2, "0")}`;
    contactIds.push(contactId);
    await context.repositories.contacts.upsert({
      id: contactId,
      salesforceContactId: null,
      displayName: `Volunteer ${String(index + 1)}`,
      primaryEmail: `${contactId}@example.org`,
      primaryPhone: null,
      createdAt: "2026-05-15T12:00:00.000Z",
      updatedAt: "2026-05-15T12:00:00.000Z",
    });
    await context.repositories.contactMemberships.upsert({
      id: `membership-${contactId}`,
      contactId,
      projectId: "project-1",
      expeditionId: null,
      salesforceMembershipId: `sf-membership-${contactId}`,
      role: "volunteer",
      status: "Active",
      source: "salesforce",
      createdAt: "2026-05-15T12:00:00.000Z",
    });
  }

  return contactIds;
}

function createMockPostmarkClient(input: {
  onBatch?: (messages: readonly { readonly To: string }[]) => Promise<void> | void;
  resultFor?: (email: string) => { readonly errorCode: number; readonly message: string };
  throwOnCall?: readonly number[];
}) {
  let calls = 0;

  return {
    async sendBatch(req: {
      readonly messages: readonly {
        readonly To: string;
      }[];
    }) {
      calls += 1;
      if (input.throwOnCall?.includes(calls)) {
        throw new Error(`Simulated batch failure on call ${String(calls)}.`);
      }

      await input.onBatch?.(req.messages);

      return {
        results: req.messages.map((message) => {
          const outcome = input.resultFor?.(message.To) ?? {
            errorCode: 0,
            message: "OK",
          };

          return {
            ErrorCode: outcome.errorCode,
            Message: outcome.message,
            MessageID: `pm-${message.To}`,
            SubmittedAt: "2026-05-15T13:00:00.000Z",
            To: message.To,
          };
        }),
      };
    },
  };
}

function createOrchestrator(
  context: Stage1Context,
  postmarkClient: ReturnType<typeof createMockPostmarkClient>,
  batchSize = 500,
) {
  const campaigns = createStage5RepositoryBundle(context.db);

  return {
    campaigns,
    orchestrator: createCampaignSendOrchestrator({
      repositories: {
        campaignRuns: campaigns.campaignRuns,
        audienceSnapshots: campaigns.audienceSnapshots,
        settingsProjects: context.settings.projects,
        orgSettings: campaigns.orgSettings,
      },
      audienceResolver: createAudienceResolver({
        repositories: {
          contacts: context.repositories.contacts,
          contactMemberships: context.repositories.contactMemberships,
          canonicalEvents: context.repositories.canonicalEvents,
          projectDimensions: context.repositories.projectDimensions,
          settingsProjects: context.settings.projects,
        },
      }),
      exclusionFilter: createExclusionFilter({
        repositories: {
          campaignRuns: campaigns.campaignRuns,
          contactConsent: campaigns.contactConsent,
          suppressionList: campaigns.suppressionList,
        },
      }),
      mergeRenderer: createMergeRenderer(),
      postmarkClient,
      appUrl: "https://test.example",
      batchSize,
    }),
  };
}

describe("Campaign send orchestrator", () => {
  const contexts: Stage1Context[] = [];

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.dispose()));
  });

  it("freezes and sends a 50-recipient audience on the happy path", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    await seedProject(context);
    await seedAudience(context, 50);
    const { campaigns, orchestrator } = createOrchestrator(
      context,
      createMockPostmarkClient({}),
    );
    const run = await campaigns.campaignRuns.create(
      buildDraftInput({ id: "run-happy-path" }),
    );

    await expect(
      orchestrator.freeze(run.id, new Date("2026-05-15T12:00:00.000Z")),
    ).resolves.toEqual({
      audienceSize: 50,
      excludedCount: 0,
    });
    await orchestrator.processSendRequest(run.id);

    const snapshots = await campaigns.audienceSnapshots.listForRun(run.id);
    const refreshedRun = await campaigns.campaignRuns.findById(run.id);

    expect(snapshots).toHaveLength(50);
    expect(snapshots.every((snapshot) => snapshot.deliveryStatus === "sent")).toBe(
      true,
    );
    expect(refreshedRun?.state).toBe("complete");
  });

  it("stops between batches when the run is cancelled mid-send", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    await seedProject(context);
    await seedAudience(context, 50);
    let orchestratorRef: ReturnType<typeof createOrchestrator>["orchestrator"] | null =
      null;
    let batchCalls = 0;
    const postmarkClient = createMockPostmarkClient({
      onBatch: async () => {
        batchCalls += 1;
        if (batchCalls === 2 && orchestratorRef !== null) {
          await orchestratorRef.cancel("run-cancel-mid-send", "operator_cancelled");
        }
      },
    });
    const runtime = createOrchestrator(context, postmarkClient, 10);
    orchestratorRef = runtime.orchestrator;
    const run = await runtime.campaigns.campaignRuns.create(
      buildDraftInput({ id: "run-cancel-mid-send" }),
    );

    await runtime.orchestrator.freeze(
      run.id,
      new Date("2026-05-15T12:00:00.000Z"),
    );
    await runtime.orchestrator.processSendRequest(run.id);

    const snapshots = await runtime.campaigns.audienceSnapshots.listForRun(run.id);
    const refreshedRun = await runtime.campaigns.campaignRuns.findById(run.id);

    expect(
      snapshots.filter((snapshot) => snapshot.deliveryStatus === "sent"),
    ).toHaveLength(20);
    expect(
      snapshots.filter((snapshot) => snapshot.deliveryStatus === "pending"),
    ).toHaveLength(30);
    expect(refreshedRun?.state).toBe("cancelled");
    expect(refreshedRun?.cancelledReason).toBe("operator_cancelled");
  });

  it("retries pending rows cleanly after a batch failure", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    await seedProject(context);
    await seedAudience(context, 50);
    const runtime = createOrchestrator(
      context,
      createMockPostmarkClient({ throwOnCall: [2] }),
      20,
    );
    const run = await runtime.campaigns.campaignRuns.create(
      buildDraftInput({ id: "run-worker-restart" }),
    );

    await runtime.orchestrator.freeze(
      run.id,
      new Date("2026-05-15T12:00:00.000Z"),
    );
    await runtime.orchestrator.processSendRequest(run.id);

    expect(
      (await runtime.campaigns.audienceSnapshots.listForRun(run.id)).filter(
        (snapshot) => snapshot.deliveryStatus === "pending",
      ),
    ).toHaveLength(30);

    await runtime.orchestrator.processSendRequest(run.id);

    const snapshots = await runtime.campaigns.audienceSnapshots.listForRun(run.id);
    const refreshedRun = await runtime.campaigns.campaignRuns.findById(run.id);

    expect(snapshots.every((snapshot) => snapshot.deliveryStatus === "sent")).toBe(
      true,
    );
    expect(refreshedRun?.state).toBe("complete");
  });

  it("re-checks exclusions at delivery time and suppresses opted-out recipients", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    await seedProject(context);
    const contactIds = await seedAudience(context, 1);
    const contactId = contactIds[0];
    if (contactId === undefined) {
      throw new Error("seedAudience did not return any contacts.");
    }
    const runtime = createOrchestrator(context, createMockPostmarkClient({}));
    const run = await runtime.campaigns.campaignRuns.create(
      buildDraftInput({ id: "run-delivery-recheck" }),
    );

    await runtime.orchestrator.freeze(
      run.id,
      new Date("2026-05-15T12:00:00.000Z"),
    );
    await runtime.campaigns.contactConsent.recordOptOut(
      contactId,
      { type: "project", id: "project-1" },
      "recipient_click",
      run.id,
    );
    await runtime.orchestrator.processSendRequest(run.id);

    const [snapshot] = await runtime.campaigns.audienceSnapshots.listForRun(run.id);

    expect(snapshot?.deliveryStatus).toBe("suppressed_at_send");
  });

  it("marks a single 4xx-like recipient response failed while continuing the rest", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    await seedProject(context);
    await seedAudience(context, 3);
    const runtime = createOrchestrator(
      context,
      createMockPostmarkClient({
        resultFor: (email) =>
          email === "contact-02@example.org"
            ? {
                errorCode: 300,
                message: "Inactive recipient.",
              }
            : {
                errorCode: 0,
                message: "OK",
              },
      }),
      3,
    );
    const run = await runtime.campaigns.campaignRuns.create(
      buildDraftInput({ id: "run-single-recipient-failure" }),
    );

    await runtime.orchestrator.freeze(
      run.id,
      new Date("2026-05-15T12:00:00.000Z"),
    );
    await runtime.orchestrator.processSendRequest(run.id);

    const snapshots = await runtime.campaigns.audienceSnapshots.listForRun(run.id);

    expect(
      snapshots.find((snapshot) => snapshot.frozenEmail === "contact-02@example.org")
        ?.deliveryStatus,
    ).toBe("failed");
    expect(
      snapshots.filter((snapshot) => snapshot.deliveryStatus === "sent"),
    ).toHaveLength(2);
  });
});
