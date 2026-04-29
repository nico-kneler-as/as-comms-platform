import { describe, expect, it } from "vitest";

import {
  gmailHistoricalCaptureBatchJobName,
  gmailHistoricalCaptureBatchPayloadSchema,
} from "@as-comms/contracts";

import { buildWorkerCrontab, readWorkerConfig } from "../src/runtime.js";
import {
  pollGmailLiveJobName,
  pollIntegrationHealthJobName,
  pollSalesforceLiveJobName,
} from "../src/orchestration/tasks.js";
import { reconcileStaleRunningJobName } from "../src/jobs/reconcile-stale-running.js";
import { sweepPendingOutboundsJobName } from "../src/jobs/sweep-pending-outbounds.js";
import { createTaskList } from "../src/tasks.js";
import {
  buildCapturedBatch,
  createEmptyCapturePorts,
  createTestWorkerContext,
  type TestWorkerContext,
} from "./helpers.js";

const contactId = "contact:salesforce:003-stage1";
const salesforceContactId = "003-stage1";
const launchScopeEnv = {
  WORKER_BOOT_MODE: "run",
  DATABASE_URL: "postgres://stage1:test@localhost:5432/as_comms_stage1",
  GMAIL_CAPTURE_BASE_URL: "https://capture.example.test/gmail",
  GMAIL_CAPTURE_TOKEN: "gmail-token",
  GMAIL_LIVE_ACCOUNT: "volunteers@adventurescientists.org",
  GMAIL_PROJECT_INBOX_ALIASES:
    "project-antarctica@example.org,project-oceans@example.org",
  SALESFORCE_CAPTURE_BASE_URL: "https://capture.example.test/salesforce",
  SALESFORCE_CAPTURE_TOKEN: "salesforce-token",
  SALESFORCE_CONTACT_CAPTURE_MODE: "cdc_compatible",
  SALESFORCE_MEMBERSHIP_CAPTURE_MODE: "cdc_compatible",
  SALESFORCE_TASK_POLL_INTERVAL_SECONDS: "300",
} as const;

async function seedContact(context: TestWorkerContext): Promise<void> {
  await context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: contactId,
      salesforceContactId,
      displayName: "Stage One Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: "+15555550123",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    identities: [
      {
        id: `identity:${contactId}:salesforce`,
        contactId,
        kind: "salesforce_contact_id",
        normalizedValue: salesforceContactId,
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: `identity:${contactId}:email`,
        contactId,
        kind: "email",
        normalizedValue: "volunteer@example.org",
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    memberships: [
      {
        id: `membership:${contactId}:project-stage1`,
        contactId,
        salesforceMembershipId: `membership:${contactId}:project-stage1:sf`,
        projectId: "project-stage1",
        expeditionId: "expedition-stage1",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
}

describe("Stage 1 worker runtime task registration", () => {
  it("accepts narrowed launch-scope env with only Gmail and Salesforce capture ports", () => {
    const config = readWorkerConfig(launchScopeEnv);

    expect(config).not.toBeNull();
    expect(config?.capture.gmail.baseUrl).toBe(
      "https://capture.example.test/gmail",
    );
    expect(config?.capture.salesforce.baseUrl).toBe(
      "https://capture.example.test/salesforce",
    );
    expect(config?.launchScope.gmail.liveAccount).toBe(
      "volunteers@adventurescientists.org",
    );
    expect(config?.launchScope.gmail.historicalBackfillMode).toBe(
      "mbox_import",
    );
    expect(config?.launchScope.salesforce.contactCaptureMode).toBe(
      "cdc_compatible",
    );
    expect(config?.capture.simpleTexting).toBeUndefined();
    expect(config?.capture.mailchimp).toBeUndefined();
  });

  it("fails closed when required Gmail or Salesforce launch-scope env is missing", () => {
    expect(() =>
      readWorkerConfig({
        ...launchScopeEnv,
        GMAIL_CAPTURE_TOKEN: undefined,
      }),
    ).toThrow();

    expect(() =>
      readWorkerConfig({
        ...launchScopeEnv,
        SALESFORCE_CONTACT_CAPTURE_MODE: undefined,
      }),
    ).toThrow();
  });

  it("fails closed when the Gmail live account is not volunteers@...", () => {
    expect(() =>
      readWorkerConfig({
        ...launchScopeEnv,
        GMAIL_LIVE_ACCOUNT: "project-antarctica@example.org",
      }),
    ).toThrow("Gmail live account must be a volunteers@... address.");
  });

  it("builds the Graphile Worker crontab for Gmail and Salesforce live polling", () => {
    const config = readWorkerConfig(launchScopeEnv);

    expect(config).not.toBeNull();
    if (config === null) {
      throw new Error("Expected launch-scope config to be present.");
    }

    expect(buildWorkerCrontab(config)).toBe(
      [
        `*/1 * * * * ${pollGmailLiveJobName} ?id=gmail-live-poll&max=1`,
        `*/5 * * * * ${pollSalesforceLiveJobName} ?id=salesforce-live-poll&max=1`,
        `*/5 * * * * ${pollIntegrationHealthJobName} ?id=integration-health-poll&max=1`,
        `*/5 * * * * ${sweepPendingOutboundsJobName} ?id=composer-orphan-sweep&max=1`,
        `* * * * * ${reconcileStaleRunningJobName} ?id=stale-running-sweep&max=1`,
        "*/15 * * * * reconcile-identity-queue ?id=identity-queue-reconcile&max=1",
        "*/15 * * * * reconcile-routing-review-queue ?id=routing-review-queue-reconcile&max=1",
      ].join("\n"),
    );
  });

  it("registers Stage 1 task names and executes them through the existing orchestration path", async () => {
    const gmailRecord = {
      recordType: "message" as const,
      recordId: "gmail-message-runtime-1",
      direction: "inbound" as const,
      occurredAt: "2026-01-01T00:00:00.000Z",
      receivedAt: "2026-01-01T00:01:00.000Z",
      payloadRef: "capture://gmail/gmail-message-runtime-1",
      checksum: "checksum-runtime-1",
      snippet: "Hello from runtime",
      threadId: "thread-runtime-1",
      rfc822MessageId: "<runtime-1@example.org>",
      normalizedParticipantEmails: ["volunteer@example.org"],
      salesforceContactId,
      volunteerIdPlainValues: [],
      normalizedPhones: [],
      supportingRecords: [],
      crossProviderCollapseKey: "collapse:runtime:1",
    };
    const capture = createEmptyCapturePorts();
    capture.gmail.captureHistoricalBatch = () =>
      Promise.resolve(
        buildCapturedBatch([gmailRecord], {
          nextCursor: "gmail:cursor:runtime:1",
          checkpoint: "gmail:checkpoint:runtime:1",
        }),
      );

    const context = await createTestWorkerContext({ capture });

    try {
      await seedContact(context);

      const taskList = createTaskList(context.orchestration);
      const task = taskList[gmailHistoricalCaptureBatchJobName];

      expect(typeof task).toBe("function");
      if (task === undefined) {
        throw new Error("Expected Gmail historical task to be registered.");
      }

      await task(
        gmailHistoricalCaptureBatchPayloadSchema.parse({
          version: 1,
          jobId: "job:gmail:runtime:1",
          correlationId: "corr:gmail:runtime:1",
          traceId: null,
          batchId: "batch:gmail:runtime:1",
          syncStateId: "sync:gmail:runtime:1",
          attempt: 1,
          maxAttempts: 3,
          provider: "gmail",
          mode: "historical",
          jobType: "historical_backfill",
          cursor: null,
          checkpoint: null,
          windowStart: "2026-01-01T00:00:00.000Z",
          windowEnd: "2026-01-01T01:00:00.000Z",
          recordIds: [gmailRecord.recordId],
          maxRecords: 10,
        }),
        {} as never,
      );

      await expect(
        context.repositories.canonicalEvents.countAll(),
      ).resolves.toBe(1);
      await expect(
        context.repositories.syncState.findById("sync:gmail:runtime:1"),
      ).resolves.toMatchObject({
        scope: "provider",
        provider: "gmail",
        jobType: "historical_backfill",
        status: "succeeded",
      });
    } finally {
      await context.dispose();
    }
  });
});
