import { afterEach, describe, expect, it } from "vitest";

import type { CreateDraftInput } from "@as-comms/contracts";
import {
  createAudienceResolver,
  createCampaignSendOrchestrator,
  createExclusionFilter,
  createMergeRenderer,
  resolveUploadedAudienceForRun,
} from "@as-comms/domain";

import {
  createStage5RepositoryBundle,
  listBroadcastUploadedRecipientsForRun,
  replaceBroadcastUploadedRecipientsForRun,
} from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

type Stage1Context = Awaited<ReturnType<typeof createTestStage1Context>>;

function buildAudienceCriteria(): CreateDraftInput["audienceCriteria"] {
  return {
    projectId: "project-1",
    projectIds: ["project-1"],
    statuses: ["Waitlist"],
    contactIds: [],
    newsletterSubscriberIds: [],
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

async function seedProject(
  context: Stage1Context,
  input: {
    readonly signature?: string;
  } = {},
) {
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
    signature: input.signature ?? "",
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
      status: "Waitlist",
      source: "salesforce",
      createdAt: "2026-05-15T12:00:00.000Z",
    });
  }

  return contactIds;
}

async function seedProjectContact(
  context: Stage1Context,
  input: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
  },
) {
  await context.repositories.contacts.upsert({
    id: input.id,
    salesforceContactId: null,
    displayName: input.displayName,
    primaryEmail: input.email,
    primaryPhone: null,
    createdAt: "2026-05-15T12:00:00.000Z",
    updatedAt: "2026-05-15T12:00:00.000Z",
  });
  await context.repositories.contactMemberships.upsert({
    id: `membership-${input.id}`,
    contactId: input.id,
    projectId: "project-1",
    expeditionId: null,
    salesforceMembershipId: `sf-membership-${input.id}`,
    role: "volunteer",
    status: "Waitlist",
    source: "salesforce",
    createdAt: "2026-05-15T12:00:00.000Z",
  });
}

async function seedUploadedRecipients(
  context: Stage1Context,
  runId: string,
  rows: Parameters<typeof replaceBroadcastUploadedRecipientsForRun>[2],
) {
  await replaceBroadcastUploadedRecipientsForRun(context.db, runId, rows);
}

function createMockPostmarkClient(input: {
  onBatch?: (
    messages: readonly {
      readonly To: string;
      readonly HtmlBody?: string;
      readonly TextBody?: string;
      readonly MessageStream?: string;
      readonly TrackOpens?: boolean;
      readonly TrackLinks?: "None" | "HtmlAndText" | "HtmlOnly" | "TextOnly";
    }[],
  ) => Promise<void> | void;
  resultFor?: (email: string) => { readonly errorCode: number; readonly message: string };
  throwOnCall?: readonly number[];
}) {
  let calls = 0;

  return {
    async sendBatch(req: {
      readonly messages: readonly {
        readonly To: string;
        readonly HtmlBody?: string;
        readonly TextBody?: string;
        readonly MessageStream?: string;
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
  broadcastMessageStream?: string,
) {
  const campaigns = createStage5RepositoryBundle(context.db);

  return {
    campaigns,
    orchestrator: createCampaignSendOrchestrator({
      repositories: {
        campaignRuns: campaigns.campaignRuns,
        audienceSnapshots: campaigns.audienceSnapshots,
        settingsProjects: context.settings.projects,
        settingsAliases: context.settings.aliases,
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
      resolveUploadedAudience: (run, at) => {
        void at;
        return resolveUploadedAudienceForRun(
          {
            uploadedRecipients: {
              listForRun: (runId) =>
                listBroadcastUploadedRecipientsForRun(context.db, runId),
            },
            contacts: context.repositories.contacts,
            settingsProjects: context.settings.projects,
            settingsAliases: context.settings.aliases,
          },
          {
            runId: run.id,
            fromEmail: run.fromEmail,
            projectId: run.projectId,
          },
        );
      },
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
      ...(broadcastMessageStream === undefined
        ? {}
        : { broadcastMessageStream }),
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

  it("rethrows batch send failures so the worker can retry", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    await seedProject(context);
    await seedAudience(context, 1);
    const runtime = createOrchestrator(
      context,
      createMockPostmarkClient({ throwOnCall: [1] }),
      1,
    );
    const run = await runtime.campaigns.campaignRuns.create(
      buildDraftInput({ id: "run-batch-failure-rethrow" }),
    );

    await runtime.orchestrator.freeze(
      run.id,
      new Date("2026-05-15T12:00:00.000Z"),
    );

    await expect(runtime.orchestrator.processSendRequest(run.id)).rejects.toThrow(
      "Simulated batch failure on call 1.",
    );

    const [snapshot] = await runtime.campaigns.audienceSnapshots.listForRun(run.id);
    const refreshedRun = await runtime.campaigns.campaignRuns.findById(run.id);

    expect(snapshot?.deliveryStatus).toBe("pending");
    expect(refreshedRun?.state).toBe("sending");
  });

  it("uses the configured broadcast message stream", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    await seedProject(context);
    await seedAudience(context, 1);

    let streams: readonly string[] = [];
    const { campaigns, orchestrator } = createOrchestrator(
      context,
      createMockPostmarkClient({
        onBatch(messages) {
          streams = messages.map((message) => message.MessageStream ?? "");
        },
      }),
      500,
      "as-newsletter-stream",
    );
    const run = await campaigns.campaignRuns.create(
      buildDraftInput({ id: "run-custom-stream" }),
    );

    await orchestrator.freeze(run.id, new Date("2026-05-15T12:00:00.000Z"));
    await orchestrator.processSendRequest(run.id);

    expect(streams).toEqual(["as-newsletter-stream"]);
  });

  it("requests open and link tracking so Postmark emits Open/Click events", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    await seedProject(context);
    await seedAudience(context, 1);

    let trackOpens: readonly (boolean | undefined)[] = [];
    let trackLinks: readonly (string | undefined)[] = [];
    const { campaigns, orchestrator } = createOrchestrator(
      context,
      createMockPostmarkClient({
        onBatch(messages) {
          trackOpens = messages.map((message) => message.TrackOpens);
          trackLinks = messages.map((message) => message.TrackLinks);
        },
      }),
      500,
    );
    const run = await campaigns.campaignRuns.create(
      buildDraftInput({ id: "run-tracking-flags" }),
    );

    await orchestrator.freeze(run.id, new Date("2026-05-15T12:00:00.000Z"));
    await orchestrator.processSendRequest(run.id);

    expect(trackOpens).toEqual([true]);
    expect(trackLinks).toEqual(["HtmlAndText"]);
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
    await expect(runtime.orchestrator.processSendRequest(run.id)).rejects.toThrow(
      "Simulated batch failure on call 2.",
    );

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

  it("freezes csv uploads through project exclusions and keeps newsletter-only opt-outs", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    const freezeAt = new Date("2026-08-15T12:00:00.000Z");
    await seedProject(context);
    await seedProjectContact(context, {
      id: "contact-all-opt-out",
      email: "all-opt-out@example.org",
      displayName: "Global Opt Out",
    });
    await seedProjectContact(context, {
      id: "contact-newsletter-only",
      email: "newsletter-only@example.org",
      displayName: "Newsletter Only",
    });
    const runtime = createOrchestrator(context, createMockPostmarkClient({}));
    const run = await runtime.campaigns.campaignRuns.create(
      buildDraftInput({
        id: "run-csv-freeze",
        fromEmail: "project-one@example.org",
        replyToEmail: "project-one@example.org",
        audienceCriteria: {
          projectId: "project-1",
          projectIds: ["project-1"],
          statuses: [],
          contactIds: [],
          newsletterSubscriberIds: [],
          expeditionIds: [],
          lastActivityWindow: "all_time",
          hasReplied: "either",
          hasClicked: "either",
          initialFilter: "csv_upload",
        },
      }),
    );
    await seedUploadedRecipients(context, run.id, [
      {
        email: "suppressed@example.org",
        firstName: "Suppressed",
        lastName: null,
      },
      {
        email: "all-opt-out@example.org",
        firstName: "Global",
        lastName: "Opt Out",
      },
      {
        email: "newsletter-only@example.org",
        firstName: "Newsletter",
        lastName: "Only",
      },
      {
        email: "new-person@example.org",
        firstName: "New",
        lastName: "Person",
      },
    ]);
    await runtime.campaigns.suppressionList.upsertFromBounce(
      "suppressed@example.org",
      "hard_bounce",
      "pm-suppressed",
      freezeAt,
    );
    await runtime.campaigns.contactConsent.recordOptOut(
      "contact-all-opt-out",
      { type: "all" },
      "recipient_click",
      run.id,
    );
    await runtime.campaigns.contactConsent.recordOptOut(
      "contact-newsletter-only",
      { type: "newsletter" },
      "recipient_click",
      run.id,
    );

    await expect(
      runtime.orchestrator.freeze(run.id, freezeAt),
    ).resolves.toEqual({
      audienceSize: 2,
      excludedCount: 2,
    });

    const snapshots = await runtime.campaigns.audienceSnapshots.listForRun(run.id);
    const refreshedRun = await runtime.campaigns.campaignRuns.findById(run.id);
    const snapshotsByEmail = new Map(
      snapshots.map((snapshot) => [snapshot.frozenEmail, snapshot] as const),
    );

    expect(snapshots).toHaveLength(2);
    expect(refreshedRun?.audienceSize).toBe(2);
    expect(snapshotsByEmail.has("suppressed@example.org")).toBe(false);
    expect(snapshotsByEmail.has("all-opt-out@example.org")).toBe(false);
    expect(snapshotsByEmail.get("newsletter-only@example.org")).toMatchObject({
      contactId: "contact-newsletter-only",
      newsletterSubscriberId: null,
      frozenFirstName: "Newsletter",
      frozenProjectId: "project-1",
      frozenProjectName: "Project One",
      frozenAliasEmail: "project-one@example.org",
    });
    expect(snapshotsByEmail.get("new-person@example.org")).toMatchObject({
      contactId: null,
      newsletterSubscriberId: null,
      frozenFirstName: "New",
      frozenProjectId: "project-1",
      frozenProjectName: "Project One",
      frozenAliasEmail: "project-one@example.org",
    });
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

  it("appends the alias signature and hidden Postmark placeholder to sent bodies", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    await seedProject(context, {
      signature: "Thanks,\n{{firstName}} Team",
    });
    await seedAudience(context, 1);
    let capturedMessage:
      | {
          readonly HtmlBody?: string;
          readonly TextBody?: string;
        }
      | undefined;
    const runtime = createOrchestrator(
      context,
      createMockPostmarkClient({
        onBatch(messages) {
          capturedMessage = messages[0];
        },
      }),
      1,
    );
    const run = await runtime.campaigns.campaignRuns.create(
      buildDraftInput({ id: "run-signature-and-placeholder" }),
    );

    await runtime.orchestrator.freeze(
      run.id,
      new Date("2026-05-15T12:00:00.000Z"),
    );
    await runtime.orchestrator.processSendRequest(run.id);

    expect(capturedMessage).toBeDefined();
    const htmlBody = capturedMessage?.HtmlBody ?? "";
    const textBody = capturedMessage?.TextBody ?? "";
    expect(htmlBody).toContain(
      '<p>Project One</p><p style="margin-top:16px;">Thanks,<br>Volunteer Team</p><hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px;">',
    );
    expect(textBody).toContain(
      "project-one@example.org\n\nThanks,\nVolunteer Team\n\nUnsubscribe from project-one emails · Unsubscribe from all Adventure Scientists emails",
    );
    expect(htmlBody.match(/\{\{\{ pm:unsubscribe \}\}\}/gu)).toHaveLength(1);
  });
});
