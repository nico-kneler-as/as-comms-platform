import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const headersMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const requireSessionMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

vi.mock("@/src/server/auth/session", () => ({
  requireAdmin: requireAdminMock,
  requireSession: requireSessionMock,
}));

import { previewSmsBroadcast } from "../../app/broadcasts/actions";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function sessionUser() {
  return {
    id: "user:admin",
    email: "admin@example.org",
  };
}

async function seedUser(runtime: Stage1WebTestRuntime): Promise<void> {
  const now = new Date("2026-07-02T12:00:00.000Z");
  await runtime.context.settings.users.upsert({
    id: "user:admin",
    name: "Admin User",
    email: "admin@example.org",
    emailVerified: now,
    image: null,
    role: "admin",
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedContact(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly id: string;
    readonly displayName: string;
    readonly email: string;
  },
): Promise<void> {
  await runtime.context.repositories.contacts.upsert({
    id: input.id,
    salesforceContactId: null,
    displayName: input.displayName,
    primaryEmail: input.email,
    primaryPhone: null,
    createdAt: "2026-07-02T12:00:00.000Z",
    updatedAt: "2026-07-02T12:00:00.000Z",
  });
}

async function seedProject(runtime: Stage1WebTestRuntime): Promise<void> {
  await runtime.context.repositories.projectDimensions.upsert({
    projectId: "project-1",
    projectName: "Project Atlas",
    projectAlias: "atlas",
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
}

async function seedMembership(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly id: string;
    readonly contactId: string;
  },
): Promise<void> {
  await runtime.context.repositories.contactMemberships.upsert({
    id: input.id,
    contactId: input.contactId,
    projectId: "project-1",
    expeditionId: null,
    role: null,
    status: "Applied",
    source: "manual",
    salesforceMembershipId: null,
    salesforceDeletedAt: null,
    salesforceReconciledAt: null,
    createdAt: "2026-07-02T12:00:00.000Z",
  });
}

async function seedSmsConsent(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly phoneE164: string;
    readonly status: "opted_in" | "revoked";
    readonly createdAt: string;
  },
): Promise<void> {
  await runtime.context.repositories.consentRecords.insert({
    id: input.id,
    contactId: input.contactId,
    phoneE164: input.phoneE164,
    status: input.status,
    source: "operator_attestation",
    sourceDetail: null,
    consentedAt:
      input.status === "opted_in" ? new Date(input.createdAt) : null,
    revokedAt: input.status === "revoked" ? new Date(input.createdAt) : null,
    recordedByUserId: "user:admin",
    notes: null,
    createdAt: new Date(input.createdAt),
    updatedAt: new Date(input.createdAt),
  });
}

async function seedSmsSender(runtime: Stage1WebTestRuntime): Promise<void> {
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
      'sender-primary',
      '+14065550999',
      'Primary SMS Sender',
      null,
      true,
      '2026-07-02T12:00:00.000Z',
      '2026-07-02T12:00:00.000Z'
    );
  `);
}

async function seedSmsBroadcastRun(
  runtime: Stage1WebTestRuntime,
  runId: string,
): Promise<void> {
  await runtime.runtime.campaigns.campaignRuns.create({
    id: runId,
    kind: "project",
    launchType: "sms",
    projectId: "project-1",
    name: "SMS launch",
    fromEmail: null,
    fromName: null,
    replyToEmail: null,
    subjectTemplate: null,
    bodyDesignJson: null,
    bodyHtmlTemplate: null,
    bodyTextTemplate: "Hi {{firstName}}",
    preheader: null,
    audienceCriteria: {
      projectId: "project-1",
      projectIds: ["project-1"],
      statuses: [],
      contactIds: ["contact-1", "contact-2"],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: null,
    createdByUserId: "user:admin",
    lastEditedByUserId: "user:admin",
  });
}

describe("previewSmsBroadcast", () => {
  let runtime: Stage1WebTestRuntime | null = null;
  let previousRate: string | undefined;

  beforeEach(async () => {
    headersMock.mockReset();
    requireAdminMock.mockReset();
    requireSessionMock.mockReset();

    headersMock.mockResolvedValue(new Headers());
    requireAdminMock.mockResolvedValue(sessionUser());
    requireSessionMock.mockResolvedValue(sessionUser());

    previousRate = process.env.TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT;
    process.env.TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT = "0.0125";

    runtime = await createStage1WebTestRuntime();
    await seedUser(runtime);
    await seedProject(runtime);
    await seedContact(runtime, {
      id: "contact-1",
      displayName: "Ada Lovelace",
      email: "ada@example.org",
    });
    await seedContact(runtime, {
      id: "contact-2",
      displayName: "Grace Hopper",
      email: "grace@example.org",
    });
    await seedMembership(runtime, {
      id: "membership-1",
      contactId: "contact-1",
    });
    await seedMembership(runtime, {
      id: "membership-2",
      contactId: "contact-2",
    });
  });

  afterEach(async () => {
    if (previousRate === undefined) {
      delete process.env.TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT;
    } else {
      process.env.TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT = previousRate;
    }
    await runtime?.dispose();
    runtime = null;
  });

  it("returns SMS preview counts, rendered sample body, and estimated cost", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedSmsBroadcastRun(runtime, "run-sms-preview");
    await seedSmsConsent(runtime, {
      id: "consent-1",
      contactId: "contact-1",
      phoneE164: "+14065550123",
      status: "opted_in",
      createdAt: "2026-07-02T12:01:00.000Z",
    });
    await seedSmsConsent(runtime, {
      id: "consent-2",
      contactId: "contact-2",
      phoneE164: "+14065550124",
      status: "revoked",
      createdAt: "2026-07-02T12:02:00.000Z",
    });
    await seedSmsSender(runtime);

    const result = await previewSmsBroadcast({
      runId: "run-sms-preview",
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        selected: 2,
        reachable: 1,
        deduplicatedByPhone: 0,
        frozen: 1,
        unreachable: {
          no_consent: 0,
          revoked: 1,
          no_phone: 0,
        },
        totalSegments: 1,
        estCostUsd: 0.0125,
      },
    });
    if (!result.ok) {
      throw new Error("Expected SMS preview action to succeed.");
    }

    expect(result.data.sampleBody).toContain("Hi Ada");
    expect(result.data.sampleBody).toContain("Reply STOP to opt out");
  });
});
