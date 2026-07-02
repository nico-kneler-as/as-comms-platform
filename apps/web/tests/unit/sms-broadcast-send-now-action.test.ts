import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sql } from "drizzle-orm";

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

import { sendSmsBroadcastNow } from "../../app/broadcasts/actions";
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

async function seedSmsSender(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly id: string;
    readonly phoneE164: string;
    readonly displayName: string;
    readonly isActive?: boolean;
  },
): Promise<void> {
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
      '${input.id}',
      '${input.phoneE164}',
      '${input.displayName}',
      null,
      ${String(input.isActive ?? true)},
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

async function installGraphileWorkerCapture(
  runtime: Stage1WebTestRuntime,
): Promise<void> {
  await runtime.context.client.exec(`
    create schema if not exists graphile_worker;

    create table if not exists graphile_worker_jobs_capture (
      identifier text not null,
      payload jsonb not null,
      run_at timestamptz null,
      job_key text null,
      job_key_mode text null,
      max_attempts integer null
    );

    create or replace function graphile_worker.add_job(
      identifier text,
      payload json,
      run_at timestamptz default null,
      job_key text default null,
      job_key_mode text default null,
      max_attempts integer default null
    ) returns bigint
    language sql
    as $$
      with inserted as (
        insert into graphile_worker_jobs_capture (
          identifier,
          payload,
          run_at,
          job_key,
          job_key_mode,
          max_attempts
        ) values ($1, $2::jsonb, $3, $4, $5, $6)
        returning 1
      )
      select 1::bigint from inserted;
    $$;
  `);
}

function normalizeRows<TRow>(
  result: readonly TRow[] | { readonly rows?: readonly TRow[] },
): readonly TRow[] {
  return Array.isArray(result)
    ? (result as readonly TRow[])
    : (((result as { readonly rows?: readonly TRow[] }).rows ?? []) as readonly TRow[]);
}

describe("sendSmsBroadcastNow", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    headersMock.mockReset();
    requireAdminMock.mockReset();
    requireSessionMock.mockReset();

    headersMock.mockResolvedValue(new Headers());
    requireAdminMock.mockResolvedValue(sessionUser());
    requireSessionMock.mockResolvedValue(sessionUser());

    runtime = await createStage1WebTestRuntime();
    await seedUser(runtime);
    await installGraphileWorkerCapture(runtime);
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
    await runtime?.dispose();
    runtime = null;
  });

  it("freezes queued SMS rows, deduplicates shared phones, schedules the run, and enqueues a send job", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    await seedSmsBroadcastRun(runtime, "run-sms-shared-phone");
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
      phoneE164: "+14065550123",
      status: "opted_in",
      createdAt: "2026-07-02T12:02:00.000Z",
    });
    await seedSmsSender(runtime, {
      id: "sender-primary",
      phoneE164: "+14065550999",
      displayName: "Primary SMS Sender",
    });

    const result = await sendSmsBroadcastNow({
      runId: "run-sms-shared-phone",
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        frozen: 1,
        reachable: 2,
        selected: 2,
        deduplicatedByPhone: 1,
        unreachable: {
          no_consent: 0,
          revoked: 0,
          no_phone: 0,
        },
      },
    });

    const queuedRows = normalizeRows<{
      readonly id: string;
      readonly contactId: string;
      readonly phoneE164: string;
      readonly senderId: string;
      readonly broadcastRunId: string | null;
      readonly sendStatus: string;
      readonly segments: number;
      readonly encoding: string;
    }>(
      (await runtime.context.db.execute(sql`
        select
          id,
          contact_id as "contactId",
          phone_e164 as "phoneE164",
          sender_id as "senderId",
          broadcast_run_id as "broadcastRunId",
          send_status as "sendStatus",
          segments,
          encoding
        from sms_messages
        order by id
      `)) as {
        readonly rows?: readonly {
          readonly id: string;
          readonly contactId: string;
          readonly phoneE164: string;
          readonly senderId: string;
          readonly broadcastRunId: string | null;
          readonly sendStatus: string;
          readonly segments: number;
          readonly encoding: string;
        }[];
      },
    );
    expect(queuedRows).toHaveLength(1);
    const [queuedRow] = queuedRows;
    expect(queuedRow).toBeDefined();
    expect(queuedRow?.phoneE164).toBe("+14065550123");
    expect(queuedRow?.senderId).toBe("sender-primary");
    expect(queuedRow?.broadcastRunId).toBe("run-sms-shared-phone");
    expect(queuedRow?.sendStatus).toBe("queued");
    expect(queuedRow?.encoding).toEqual(expect.any(String));
    expect(queuedRow?.contactId).toMatch(/contact-[12]/);
    expect(queuedRow?.segments).toBeGreaterThan(0);

    const refreshedRun = await runtime.runtime.campaigns.campaignRuns.findById(
      "run-sms-shared-phone",
    );
    expect(refreshedRun?.state).toBe("scheduled");
    expect(refreshedRun?.audienceSize).toBe(1);

    const jobs = normalizeRows<{
      readonly identifier: string;
      readonly jobKey: string | null;
      readonly jobKeyMode: string | null;
      readonly maxAttempts: number | null;
      readonly payload: { readonly runId: string };
    }>(
      (await runtime.context.db.execute(sql`
        select
          identifier,
          job_key as "jobKey",
          job_key_mode as "jobKeyMode",
          max_attempts as "maxAttempts",
          payload
        from graphile_worker_jobs_capture
      `)) as {
        readonly rows?: readonly {
          readonly identifier: string;
          readonly jobKey: string | null;
          readonly jobKeyMode: string | null;
          readonly maxAttempts: number | null;
          readonly payload: { readonly runId: string };
        }[];
      },
    );
    expect(jobs).toEqual([
      {
        identifier: "sms-broadcast-send",
        jobKey: "sms-broadcast-send:run-sms-shared-phone",
        jobKeyMode: "replace",
        maxAttempts: 5,
        payload: { runId: "run-sms-shared-phone" },
      },
    ]);
  });

  it.each([
    ["no sender", []],
    [
      "multiple active senders",
      [
        {
          id: "sender-a",
          phoneE164: "+14065550991",
          displayName: "Sender A",
        },
        {
          id: "sender-b",
          phoneE164: "+14065550992",
          displayName: "Sender B",
        },
      ],
    ],
  ] as const)(
    "rolls back the freeze when there is %s",
    async (_label, senders) => {
      if (runtime === null) {
        throw new Error("Expected runtime.");
      }

      await seedSmsBroadcastRun(runtime, `run-${_label.replaceAll(" ", "-")}`);
      await seedSmsConsent(runtime, {
        id: `consent-${_label}`,
        contactId: "contact-1",
        phoneE164: "+14065550123",
        status: "opted_in",
        createdAt: "2026-07-02T12:01:00.000Z",
      });
      for (const sender of senders) {
        await seedSmsSender(runtime, sender);
      }

      const result = await sendSmsBroadcastNow({
        runId: `run-${_label.replaceAll(" ", "-")}`,
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("Expected SMS send action to fail.");
      }
      expect(result.code).toBe("campaign_sms_send_failed");
      expect(result.message).toBe(
        `expected exactly one active SMS sender, found ${String(senders.length)}`,
      );
      expect(result.requestId).toEqual(expect.any(String));
      expect(result.retryable).toBe(true);

      const queuedRows = normalizeRows<{
        readonly id: string;
      }>(
        (await runtime.context.db.execute(sql`
          select id from sms_messages
        `)) as { readonly rows?: readonly { readonly id: string }[] },
      );
      expect(queuedRows).toHaveLength(0);

      const run = await runtime.runtime.campaigns.campaignRuns.findById(
        `run-${_label.replaceAll(" ", "-")}`,
      );
      expect(run?.state).toBe("draft");
      expect(run?.audienceSize).toBeNull();

      const jobs = normalizeRows<{
        readonly identifier: string;
      }>(
        (await runtime.context.db.execute(sql`
          select identifier from graphile_worker_jobs_capture
        `)) as { readonly rows?: readonly { readonly identifier: string }[] },
      );
      expect(jobs).toHaveLength(0);
    },
  );
});
