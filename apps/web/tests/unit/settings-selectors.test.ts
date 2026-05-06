import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
}));

const getCurrentUser = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/session", () => ({
  getCurrentUser,
}));

import {
  loadAccessSettings,
  loadIntegrationHealth,
  loadLogsSettings,
  loadProjectSettingsDetail,
  loadProjectsSettings,
} from "../../src/server/settings/selectors";
import { waitForPendingSecurityAuditTasksForTests } from "../../src/server/security/audit";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function buildUser(input: {
  readonly id: string;
  readonly email: string;
  readonly role: "admin" | "operator";
  readonly emailVerified?: Date | null;
  readonly deactivatedAt?: Date | null;
}): {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: Date | null;
  readonly image: null;
  readonly role: "admin" | "operator";
  readonly deactivatedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
} {
  const now = new Date("2026-04-20T15:00:00.000Z");
  return {
    id: input.id,
    name: input.email.split("@")[0] ?? input.email,
    email: input.email,
    emailVerified:
      input.emailVerified === undefined ? now : input.emailVerified,
    image: null,
    role: input.role,
    deactivatedAt: input.deactivatedAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

async function seedProject(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly projectId: string;
    readonly projectName: string;
    readonly projectAlias?: string | null;
    readonly isActive: boolean;
    readonly aiKnowledgeUrl: string | null;
    readonly aiKnowledgeSyncedAt?: string | null;
    readonly emails: readonly string[];
    readonly memberCount: number;
  },
): Promise<void> {
  await runtime.context.repositories.projectDimensions.upsert({
    projectId: input.projectId,
    projectName: input.projectName,
    projectAlias:
      input.projectAlias === undefined ? input.projectName : input.projectAlias,
    source: "salesforce",
    isActive: input.isActive,
    aiKnowledgeUrl: input.aiKnowledgeUrl,
    aiKnowledgeSyncedAt: input.aiKnowledgeSyncedAt ?? null,
  });

  if (
    input.aiKnowledgeUrl !== null &&
    (input.aiKnowledgeSyncedAt ?? null) !== null
  ) {
    await runtime.context.repositories.aiKnowledge.upsert({
      id: `ai_knowledge:notion:${input.projectId}`,
      scope: "project",
      scopeKey: input.projectId,
      sourceProvider: "notion",
      sourceId: `${input.projectId}-page`,
      sourceUrl: input.aiKnowledgeUrl,
      title: "Project context",
      content: "Grounding",
      contentHash: "hash",
      metadataJson: {},
      sourceLastEditedAt: null,
      syncedAt: input.aiKnowledgeSyncedAt ?? "2026-04-20T15:00:00.000Z",
      createdAt: "2026-04-20T15:00:00.000Z",
      updatedAt: "2026-04-20T15:00:00.000Z",
    });
  }

  for (const [index, email] of input.emails.entries()) {
    await runtime.context.settings.aliases.create({
      id: `${input.projectId}:alias:${String(index)}`,
      alias: email,
      signature: "",
      projectId: input.projectId,
      createdAt: new Date(`2026-04-20T15:0${String(index)}:00.000Z`),
      updatedAt: new Date(`2026-04-20T15:0${String(index)}:00.000Z`),
      createdBy: null,
      updatedBy: null,
    });
  }

  for (let index = 0; index < input.memberCount; index += 1) {
    const contactId = `contact:${input.projectId}:${String(index)}`;
    await runtime.context.repositories.contacts.upsert({
      id: contactId,
      salesforceContactId: null,
      displayName: `${input.projectName} Member ${String(index + 1)}`,
      primaryEmail: null,
      primaryPhone: null,
      createdAt: "2026-04-20T15:00:00.000Z",
      updatedAt: "2026-04-20T15:00:00.000Z",
    });
    await runtime.context.repositories.contactMemberships.upsert({
      id: `${input.projectId}:membership:${String(index)}`,
      contactId,
      projectId: input.projectId,
      expeditionId: null,
      salesforceMembershipId: `${input.projectId}:membership:${String(index)}:sf`,
      role: "volunteer",
      status: "active",
      source: "salesforce",
      createdAt: `2026-04-20T15:${String(index).padStart(2, "0")}:00.000Z`,
    });
  }
}

async function seedSourceEvidenceCollision(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly provider: "gmail" | "salesforce";
    readonly idempotencyKey: string;
    readonly winningId: string;
    readonly losingId: string;
    readonly winningReceivedAt: string;
    readonly losingAttemptedAt: string;
  },
): Promise<void> {
  await runtime.context.repositories.sourceEvidence.append({
    id: input.winningId,
    provider: input.provider,
    providerRecordType: "message",
    providerRecordId: `${input.winningId}:record`,
    receivedAt: input.winningReceivedAt,
    occurredAt: input.winningReceivedAt,
    payloadRef: `payloads/${input.provider}/${input.winningId}.json`,
    idempotencyKey: input.idempotencyKey,
    checksum: `${input.winningId}:checksum`,
  });
  await runtime.context.repositories.sourceEvidenceQuarantine.record({
    provider: input.provider,
    idempotencyKey: input.idempotencyKey,
    checksum: `${input.losingId}:checksum`,
    attemptedAt: new Date(input.losingAttemptedAt),
    reason: "checksum_mismatch",
    payloadRef: `payloads/${input.provider}/${input.losingId}.json`,
    details: {
      id: input.losingId,
      provider: input.provider,
      providerRecordType: "message",
      providerRecordId: `${input.losingId}:record`,
      receivedAt: input.losingAttemptedAt,
      occurredAt: input.losingAttemptedAt,
      payloadRef: `payloads/${input.provider}/${input.losingId}.json`,
      idempotencyKey: input.idempotencyKey,
      checksum: `${input.losingId}:checksum`,
    },
  });
}

async function seedMailchimpCampaignEvent(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly sourceEvidenceId: string;
    readonly providerRecordId: string;
    readonly canonicalEventId: string;
    readonly activityType: "sent" | "opened" | "clicked" | "unsubscribed";
    readonly eventType:
      | "campaign.email.sent"
      | "campaign.email.opened"
      | "campaign.email.clicked"
      | "campaign.email.unsubscribed";
    readonly campaignId: string;
    readonly campaignName: string;
    readonly occurredAt: string;
  },
): Promise<void> {
  await runtime.context.normalization.applyNormalizedCanonicalEvent({
    sourceEvidence: {
      id: input.sourceEvidenceId,
      provider: "mailchimp",
      providerRecordType: "campaign_member_activity",
      providerRecordId: input.providerRecordId,
      receivedAt: input.occurredAt,
      occurredAt: input.occurredAt,
      payloadRef: `payloads/mailchimp/${input.providerRecordId}.json`,
      idempotencyKey: `mailchimp:${input.providerRecordId}`,
      checksum: `checksum:${input.providerRecordId}`,
    },
    canonicalEvent: {
      id: input.canonicalEventId,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      idempotencyKey: `canonical:${input.providerRecordId}`,
      summary: `Mailchimp ${input.activityType}`,
      snippet: "",
    },
    identity: {
      salesforceContactId: null,
      volunteerIdPlainValues: [],
      normalizedEmails: ["volunteer@example.org"],
      normalizedPhones: [],
    },
    supportingSources: [],
    mailchimpCampaignActivityDetail: {
      sourceEvidenceId: input.sourceEvidenceId,
      providerRecordId: input.providerRecordId,
      activityType: input.activityType,
      campaignId: input.campaignId,
      audienceId: "audience-1",
      memberId: `member:${input.providerRecordId}`,
      campaignName: input.campaignName,
      snippet: "",
    },
  });
}

describe("settings selectors", () => {
  let runtime: Stage1WebTestRuntime | null = null;
  const originalSmsEnabled = process.env.SMS_ENABLED;
  const originalTwilioRate = process.env.TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT;
  const originalMailchimpCaptureBaseUrl =
    process.env.MAILCHIMP_CAPTURE_BASE_URL;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T12:00:00.000Z"));
    runtime = await createStage1WebTestRuntime();
    getCurrentUser.mockReset();
    getCurrentUser.mockResolvedValue({
      id: "user:admin",
      role: "admin",
    });
    process.env.SMS_ENABLED = "true";
    process.env.TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT = "0.0079";
  });

  afterEach(async () => {
    if (originalSmsEnabled === undefined) {
      delete process.env.SMS_ENABLED;
    } else {
      process.env.SMS_ENABLED = originalSmsEnabled;
    }
    if (originalTwilioRate === undefined) {
      delete process.env.TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT;
    } else {
      process.env.TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT = originalTwilioRate;
    }
    if (originalMailchimpCaptureBaseUrl === undefined) {
      delete process.env.MAILCHIMP_CAPTURE_BASE_URL;
    } else {
      process.env.MAILCHIMP_CAPTURE_BASE_URL = originalMailchimpCaptureBaseUrl;
    }
    vi.useRealTimers();
    await waitForPendingSecurityAuditTasksForTests();
    await runtime?.dispose();
    runtime = null;
  });

  it("returns only active projects for the active filter with accurate counts", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:active-ready",
      projectName: "Ready Project",
      isActive: true,
      aiKnowledgeUrl: "https://www.notion.so/ready",
      emails: ["ready@asc.internal"],
      memberCount: 2,
    });
    await seedProject(runtime, {
      projectId: "project:active-missing-knowledge",
      projectName: "Missing Knowledge",
      isActive: true,
      aiKnowledgeUrl: null,
      emails: ["missing@asc.internal"],
      memberCount: 1,
    });
    await seedProject(runtime, {
      projectId: "project:inactive",
      projectName: "Inactive Project",
      isActive: false,
      aiKnowledgeUrl: "https://www.notion.so/inactive",
      emails: ["inactive@asc.internal"],
      memberCount: 3,
    });

    const viewModel = await loadProjectsSettings({
      filter: "active",
    });

    expect(viewModel.active).toHaveLength(2);
    expect(viewModel.active.every((project) => project.isActive)).toBe(true);
    expect(viewModel.inactive).toHaveLength(0);
    expect(viewModel.counts).toEqual({
      active: 2,
      inactive: 0,
      total: 2,
    });
  });

  it("marks activation requirements met only when a project has an alias plus AI knowledge sync", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:ready",
      projectName: "Ready Project",
      isActive: true,
      aiKnowledgeUrl: "https://www.notion.so/ready",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: ["ready@asc.internal"],
      memberCount: 1,
    });
    await seedProject(runtime, {
      projectId: "project:no-knowledge",
      projectName: "No Knowledge",
      isActive: true,
      aiKnowledgeUrl: "https://www.notion.so/no-knowledge",
      emails: ["knowledge-missing@asc.internal"],
      memberCount: 1,
    });
    await seedProject(runtime, {
      projectId: "project:no-email",
      projectName: "No Email",
      projectAlias: null,
      isActive: false,
      aiKnowledgeUrl: "https://www.notion.so/no-email",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: [],
      memberCount: 0,
    });

    const viewModel = await loadProjectsSettings({
      filter: "all",
    });
    const projects = [...viewModel.active, ...viewModel.inactive];

    expect(
      projects.find((project) => project.projectId === "project:ready")
        ?.activationRequirementsMet,
    ).toBe(true);
    expect(
      projects.find((project) => project.projectId === "project:ready")
        ?.projectAlias,
    ).toBe("Ready Project");
    expect(
      projects.find((project) => project.projectId === "project:ready")
        ?.suggestedAlias,
    ).toBe("Ready Project");
    expect(
      projects.find((project) => project.projectId === "project:no-knowledge")
        ?.activationRequirementsMet,
    ).toBe(false);
    expect(
      projects.find((project) => project.projectId === "project:no-email")
        ?.activationRequirementsMet,
    ).toBe(false);
  });

  it("matches project searches on the short alias as well as the full project name", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:alias-search",
      projectName: "Searching For Killer Whales 2025/2026",
      projectAlias: "SFKW",
      isActive: true,
      aiKnowledgeUrl: "https://www.notion.so/whales",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: ["whales@asc.internal"],
      memberCount: 1,
    });

    const byAlias = await loadProjectsSettings({
      filter: "all",
      search: "sfkw",
    });

    expect(byAlias.active.map((project) => project.projectId)).toEqual([
      "project:alias-search",
    ]);
  });

  it("derives a suggested alias from the project name for active and inactive rows", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await seedProject(runtime, {
      projectId: "project:colon",
      projectName: "Habitat Recovery: Restoring White Oak Savanna",
      isActive: true,
      aiKnowledgeUrl: "https://www.notion.so/white-oak",
      aiKnowledgeSyncedAt: "2026-04-20T15:00:00.000Z",
      emails: ["white-oak@asc.internal"],
      memberCount: 1,
    });
    await seedProject(runtime, {
      projectId: "project:prefix",
      projectName: "Searching For Killer Whales 2025/2026",
      isActive: false,
      aiKnowledgeUrl: "https://www.notion.so/whales",
      emails: ["whales@asc.internal"],
      memberCount: 0,
    });

    const viewModel = await loadProjectsSettings({
      filter: "all",
    });

    expect(
      viewModel.active.find((project) => project.projectId === "project:colon")
        ?.suggestedAlias,
    ).toBe("White Oak Savanna");
    expect(
      viewModel.inactive.find(
        (project) => project.projectId === "project:prefix",
      )?.suggestedAlias,
    ).toBe("Killer Whales 2025/2026");
  });

  it("returns null when project detail is requested for an unknown id", async () => {
    await expect(
      loadProjectSettingsDetail("project:does-not-exist"),
    ).resolves.toBeNull();
  });

  it("buckets admins and internal users from the users table", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await runtime.context.settings.users.upsert(
      buildUser({
        id: "user:admin",
        email: "admin@adventurescientists.org",
        role: "admin",
        emailVerified: null,
      }),
    );
    await runtime.context.settings.users.upsert(
      buildUser({
        id: "user:admin-secondary",
        email: "admin.secondary@adventurescientists.org",
        role: "admin",
        emailVerified: null,
      }),
    );
    await runtime.context.settings.users.upsert(
      buildUser({
        id: "user:operator-active",
        email: "operator.active@adventurescientists.org",
        role: "operator",
      }),
    );
    await runtime.context.settings.users.upsert(
      buildUser({
        id: "user:operator-pending",
        email: "operator.pending@adventurescientists.org",
        role: "operator",
        emailVerified: null,
      }),
    );

    const viewModel = await loadAccessSettings();

    expect(viewModel.admins.map((user) => user.userId)).toEqual([
      "user:admin",
      "user:admin-secondary",
    ]);
    expect(viewModel.admins.map((user) => user.status)).toEqual([
      "active",
      "active",
    ]);
    expect(viewModel.internalUsers.map((user) => user.userId)).toEqual([
      "user:operator-active",
      "user:operator-pending",
    ]);
    expect(viewModel.internalUsers.map((user) => user.role)).toEqual([
      "internal_user",
      "internal_user",
    ]);
    expect(viewModel.internalUsers.map((user) => user.status)).toEqual([
      "active",
      "pending",
    ]);
  });

  it("rejects non-admin callers from loading access settings", async () => {
    getCurrentUser.mockResolvedValueOnce({
      id: "user:operator",
      role: "operator",
    });

    await expect(loadAccessSettings()).rejects.toThrow("FORBIDDEN");
  });

  it("returns the visible seeded integrations in stable order on first read", async () => {
    const viewModel = await loadIntegrationHealth();

    expect(
      viewModel.integrations.map((integration) => integration.serviceName),
    ).toEqual(["salesforce", "gmail", "mailchimp", "notion", "openai"]);
    expect(
      viewModel.integrations.map((integration) => integration.status),
    ).toEqual([
      "not_checked",
      "not_checked",
      "not_configured",
      "not_configured",
      "not_configured",
    ]);
  });

  it("derives Mailchimp connected health from the latest successful transition sync and canonical events", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    delete process.env.MAILCHIMP_CAPTURE_BASE_URL;

    await seedMailchimpCampaignEvent(runtime, {
      sourceEvidenceId: "sev-mailchimp-sent",
      providerRecordId: "campaign-1:member-1:sent",
      canonicalEventId: "evt-mailchimp-sent",
      activityType: "sent",
      eventType: "campaign.email.sent",
      campaignId: "campaign-1",
      campaignName: "Spring Update",
      occurredAt: "2026-05-03T11:15:00.000Z",
    });
    await seedMailchimpCampaignEvent(runtime, {
      sourceEvidenceId: "sev-mailchimp-opened",
      providerRecordId: "campaign-1:member-1:opened",
      canonicalEventId: "evt-mailchimp-opened",
      activityType: "opened",
      eventType: "campaign.email.opened",
      campaignId: "campaign-1",
      campaignName: "Spring Update",
      occurredAt: "2026-05-03T11:20:00.000Z",
    });
    await runtime.context.repositories.syncState.upsert({
      id: "sync:mailchimp:transition:latest",
      scope: "provider",
      provider: "mailchimp",
      jobType: "live_ingest",
      cursor: "cursor:mailchimp",
      windowStart: "2026-05-03T11:00:00.000Z",
      windowEnd: "2026-05-03T11:30:00.000Z",
      status: "succeeded",
      parityPercent: null,
      freshnessP95Seconds: null,
      freshnessP99Seconds: null,
      lastSuccessfulAt: "2026-05-03T11:30:00.000Z",
      consecutiveFailureCount: 0,
      leaseOwner: null,
      heartbeatAt: null,
      deadLetterCount: 0,
    });

    const viewModel = await loadIntegrationHealth();
    const mailchimp = viewModel.integrations.find(
      (integration) => integration.serviceName === "mailchimp",
    );

    expect(mailchimp).toMatchObject({
      status: "healthy",
      lastCheckedAt: "2026-05-03T11:30:00.000Z",
      mailchimp: {
        status: "connected",
        lastSuccessfulSyncAt: "2026-05-03T11:30:00.000Z",
        lastCampaignName: "Spring Update",
        lastCampaignSentAt: "2026-05-03T11:15:00.000Z",
        lastBatchRecipientCount: 2,
      },
    });
  });

  it("keeps recent Mailchimp campaign evidence stale instead of not configured when web env is unset", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    delete process.env.MAILCHIMP_CAPTURE_BASE_URL;

    await seedMailchimpCampaignEvent(runtime, {
      sourceEvidenceId: "sev-mailchimp-recent-sent",
      providerRecordId: "campaign-recent:member-1:sent",
      canonicalEventId: "evt-mailchimp-recent-sent",
      activityType: "sent",
      eventType: "campaign.email.sent",
      campaignId: "campaign-recent",
      campaignName: "Recent Campaign",
      occurredAt: "2026-05-01T12:00:00.000Z",
    });

    const viewModel = await loadIntegrationHealth();
    const mailchimp = viewModel.integrations.find(
      (integration) => integration.serviceName === "mailchimp",
    );

    expect(mailchimp).toMatchObject({
      status: "needs_attention",
      mailchimp: {
        status: "stale",
        lastSuccessfulSyncAt: null,
        lastCampaignName: "Recent Campaign",
        lastCampaignSentAt: "2026-05-01T12:00:00.000Z",
        lastBatchRecipientCount: null,
      },
    });
  });

  it("marks Mailchimp stale when the last successful transition sync is older than 70 minutes", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    process.env.MAILCHIMP_CAPTURE_BASE_URL =
      "https://mailchimp-capture.internal";

    await runtime.context.repositories.syncState.upsert({
      id: "sync:mailchimp:transition:stale",
      scope: "provider",
      provider: "mailchimp",
      jobType: "live_ingest",
      cursor: null,
      windowStart: "2026-05-03T09:00:00.000Z",
      windowEnd: "2026-05-03T09:10:00.000Z",
      status: "succeeded",
      parityPercent: null,
      freshnessP95Seconds: null,
      freshnessP99Seconds: null,
      lastSuccessfulAt: "2026-05-03T09:10:00.000Z",
      consecutiveFailureCount: 0,
      leaseOwner: null,
      heartbeatAt: null,
      deadLetterCount: 0,
    });

    const viewModel = await loadIntegrationHealth();
    const mailchimp = viewModel.integrations.find(
      (integration) => integration.serviceName === "mailchimp",
    );

    expect(mailchimp).toMatchObject({
      status: "needs_attention",
      mailchimp: {
        status: "stale",
      },
    });
  });

  it("aggregates Twilio MTD spend and monthly cap from outbound SMS usage", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await runtime.context.client.exec(`
      insert into sms_senders (
        id,
        phone_e164,
        display_name,
        monthly_cap,
        is_active,
        created_at,
        updated_at
      ) values (
        'sender-1',
        '+14065550142',
        'Adventure Scientists',
        40,
        true,
        '2026-05-01T00:00:00.000Z',
        '2026-05-01T00:00:00.000Z'
      );
    `);

    await runtime.context.repositories.contacts.upsert({
      id: "contact:settings:sms",
      salesforceContactId: null,
      displayName: "SMS Volunteer",
      primaryEmail: null,
      primaryPhone: "+14065550123",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });

    await runtime.context.settings.users.upsert(
      buildUser({
        id: "user:admin",
        email: "admin@example.org",
        role: "admin",
      }),
    );

    await runtime.context.repositories.smsMessages.insert({
      id: "sms:outbound:current-month",
      twilioMessageSid: "SM-current",
      direction: "outbound",
      contactId: "contact:settings:sms",
      phoneE164: "+14065550123",
      senderId: "sender-1",
      body: "Current month outbound",
      segments: 547,
      encoding: "GSM-7",
      mediaUrls: null,
      sendStatus: "sent",
      failedReason: null,
      failedDetail: null,
      sentAt: new Date("2026-05-02T12:00:00.000Z"),
      receivedAt: null,
      actorId: "user:admin",
      createdAt: new Date("2026-05-02T12:00:00.000Z"),
      updatedAt: new Date("2026-05-02T12:00:00.000Z"),
    });
    await runtime.context.repositories.smsMessages.insert({
      id: "sms:outbound:previous-month",
      twilioMessageSid: "SM-previous",
      direction: "outbound",
      contactId: "contact:settings:sms",
      phoneE164: "+14065550123",
      senderId: "sender-1",
      body: "Previous month outbound",
      segments: 100,
      encoding: "GSM-7",
      mediaUrls: null,
      sendStatus: "sent",
      failedReason: null,
      failedDetail: null,
      sentAt: new Date("2026-04-20T12:00:00.000Z"),
      receivedAt: null,
      actorId: "user:admin",
      createdAt: new Date("2026-04-20T12:00:00.000Z"),
      updatedAt: new Date("2026-04-20T12:00:00.000Z"),
    });

    const viewModel = await loadIntegrationHealth();

    expect(viewModel.twilioCard.monthToDateSegments).toBe(547);
    expect(viewModel.twilioCard.monthToDateSpendUsd).toBeCloseTo(4.3213, 4);
    expect(viewModel.twilioCard.monthlyCapUsd).toBe(40);
    expect(viewModel.twilioCard.outboundRateUsdPerSegment).toBe(0.0079);
  });

  it("returns a null Twilio monthly cap when the active sender has no cap", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await runtime.context.client.exec(`
      insert into sms_senders (
        id,
        phone_e164,
        display_name,
        monthly_cap,
        is_active,
        created_at,
        updated_at
      ) values (
        'sender-uncapped',
        '+14065550143',
        'Uncapped Sender',
        null,
        true,
        '2026-05-01T00:00:00.000Z',
        '2026-05-01T00:00:00.000Z'
      );
    `);

    const viewModel = await loadIntegrationHealth();

    expect(viewModel.twilioCard.monthToDateSegments).toBe(0);
    expect(viewModel.twilioCard.monthToDateSpendUsd).toBe(0);
    expect(viewModel.twilioCard.monthlyCapUsd).toBeNull();
  });

  it("maps source-evidence collisions into the logs settings view model", async () => {
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await seedSourceEvidenceCollision(runtime, {
      provider: "gmail",
      idempotencyKey: "gmail:collision:newer",
      winningId: "sev-newer-winning",
      losingId: "sev-newer-losing",
      winningReceivedAt: "2026-04-20T14:00:00.000Z",
      losingAttemptedAt: "2026-04-20T14:05:00.000Z",
    });
    await seedSourceEvidenceCollision(runtime, {
      provider: "salesforce",
      idempotencyKey: "salesforce:collision:older",
      winningId: "sev-older-winning",
      losingId: "sev-older-losing",
      winningReceivedAt: "2026-04-20T13:00:00.000Z",
      losingAttemptedAt: "2026-04-20T13:05:00.000Z",
    });
    for (let index = 0; index < 24; index += 1) {
      const minute = String(index).padStart(2, "0");
      await seedSourceEvidenceCollision(runtime, {
        provider: "gmail",
        idempotencyKey: `gmail:collision:extra:${minute}`,
        winningId: `sev-extra-winning-${minute}`,
        losingId: `sev-extra-losing-${minute}`,
        winningReceivedAt: `2026-04-20T12:${minute}:00.000Z`,
        losingAttemptedAt: `2026-04-20T12:${minute}:30.000Z`,
      });
    }

    const viewModel = await loadLogsSettings({
      streamId: "source-evidence-quarantine",
      beforeTimestamp: null,
    });

    expect(viewModel.streams).toEqual([
      {
        id: "source-evidence-quarantine",
        label: "Source-evidence duplicates",
        description:
          "Provider replay collisions kept out of canonical history.",
      },
    ]);
    expect(viewModel.activeStreamId).toBe("source-evidence-quarantine");
    expect(viewModel.entries[0]).toMatchObject({
      id: "gmail:gmail:collision:newer",
      streamId: "source-evidence-quarantine",
      timestamp: "2026-04-20T14:05:00.000Z",
      summary:
        "Gmail • 2 payload versions for one idempotency key; canonical winner preserved",
      detail: {
        provider: "gmail",
        idempotencyKey: "gmail:collision:newer",
        winning: {
          sourceEvidenceId: "sev-newer-winning",
          checksum: "sev-newer-winning:checksum",
          receivedAt: "2026-04-20T14:00:00.000Z",
        },
        losing: [
          {
            checksum: "sev-newer-losing:checksum",
            attemptedAt: "2026-04-20T14:05:00.000Z",
          },
        ],
      },
    });
    const firstLosingDetail = (
      viewModel.entries[0]?.detail as {
        readonly losing: readonly {
          readonly quarantineId: string;
        }[];
      }
    ).losing[0];
    expect(typeof firstLosingDetail?.quarantineId).toBe("string");
    expect(typeof viewModel.nextBeforeTimestamp).toBe("string");
    expect(viewModel.nextBeforeTimestamp).not.toBeNull();
  });
});
