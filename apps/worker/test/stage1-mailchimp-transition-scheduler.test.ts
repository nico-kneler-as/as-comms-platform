import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mailchimpTransitionCaptureBatchJobName,
  type MailchimpTransitionCaptureBatchPayload,
} from "@as-comms/contracts";
import type { MailchimpRecord } from "@as-comms/integrations";

import {
  createStage1TaskList,
  mailchimpTransitionDiscoverySyncStateId,
  mailchimpTransitionSchedulerJobName,
} from "../src/orchestration/index.js";
import {
  buildCapturedBatch,
  createEmptyCapturePorts,
  createTestWorkerContext,
  type TestWorkerContext,
} from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
});

function createMailchimpActivityRecord(input: {
  readonly recordId: string;
  readonly activityType: "sent" | "opened" | "clicked" | "unsubscribed";
  readonly occurredAt: string;
  readonly campaignId: string;
  readonly audienceId: string;
  readonly memberId: string;
  readonly normalizedEmail?: string;
  readonly campaignName?: string;
}): MailchimpRecord {
  return {
    recordType: "campaign_member_activity",
    recordId: input.recordId,
    activityType: input.activityType,
    occurredAt: input.occurredAt,
    receivedAt: "2026-02-10T12:00:00.000Z",
    payloadRef: `mailchimp-api://${input.campaignId}#record=${input.recordId}`,
    checksum: `checksum:${input.recordId}`,
    normalizedEmail: input.normalizedEmail ?? "volunteer@example.org",
    salesforceContactId: null,
    volunteerIdPlainValues: [],
    normalizedPhones: [],
    campaignId: input.campaignId,
    audienceId: input.audienceId,
    memberId: input.memberId,
    campaignName: input.campaignName ?? "Volunteer Update",
    snippet: `${input.activityType}:${input.recordId}`,
  };
}

async function seedTailState(
  context: TestWorkerContext,
  input: {
    readonly campaignId: string;
    readonly audienceId: string;
    readonly firstSeenSendTime: string;
    readonly lastActivitySeenAt?: string | null;
    readonly lastPolledAt?: string | null;
  },
): Promise<void> {
  await context.mailchimpTailState.upsert({
    campaignId: input.campaignId,
    audienceId: input.audienceId,
    firstSeenSendTime: input.firstSeenSendTime,
  });

  if (input.lastActivitySeenAt !== undefined && input.lastActivitySeenAt !== null) {
    await context.mailchimpTailState.updateLastActivitySeenAt({
      campaignId: input.campaignId,
      lastActivitySeenAt: input.lastActivitySeenAt,
    });
  }

  if (input.lastPolledAt !== undefined && input.lastPolledAt !== null) {
    await context.mailchimpTailState.markPolled({
      campaignId: input.campaignId,
      polledAt: input.lastPolledAt,
    });
  }
}

async function seedKnownContact(context: TestWorkerContext): Promise<void> {
  await context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: "contact:mailchimp:known",
      salesforceContactId: "003-mailchimp-known",
      displayName: "Known Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    identities: [
      {
        id: "identity:mailchimp:known:sf",
        contactId: "contact:mailchimp:known",
        kind: "salesforce_contact_id",
        normalizedValue: "003-mailchimp-known",
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "identity:mailchimp:known:email",
        contactId: "contact:mailchimp:known",
        kind: "email",
        normalizedValue: "volunteer@example.org",
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    memberships: [],
  });
}

describe("Mailchimp transition scheduler", () => {
  it("short-circuits when the transition scheduler is disabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-10T12:00:00.000Z"));

    const logger = {
      info: vi.fn(),
    };
    const capture = createEmptyCapturePorts();
    const captureTransitionBatch = vi.fn(() =>
      Promise.resolve(buildCapturedBatch<MailchimpRecord>([])),
    );
    capture.mailchimp.captureTransitionBatch = captureTransitionBatch;

    const context = await createTestWorkerContext({
      capture,
      logger,
      mailchimpTransition: {
        enabled: false,
      },
    });

    try {
      const task =
        createStage1TaskList(context.orchestration)[
          mailchimpTransitionSchedulerJobName
        ];

      expect(task).toBeTypeOf("function");
      if (task === undefined) {
        throw new Error("Expected Mailchimp transition scheduler task.");
      }

      const addJob = vi.fn(() => Promise.resolve({ id: "job:ignored" }));
      await task({}, { addJob } as never);

      expect(addJob).not.toHaveBeenCalled();
      expect(captureTransitionBatch).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith("[mailchimp.scheduler] disabled");
    } finally {
      await context.dispose();
    }
  });

  it("discovers new campaigns, refreshes eligible tails, and drops campaigns older than 30 days", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-10T12:00:00.000Z"));

    const logger = {
      info: vi.fn(),
    };
    const capture = createEmptyCapturePorts();
    const captureTransitionBatch = vi.fn(
      (payload: MailchimpTransitionCaptureBatchPayload) => {
      expect(payload.recordIds).toEqual([]);

        return Promise.resolve(
          buildCapturedBatch<MailchimpRecord>([
            createMailchimpActivityRecord({
              recordId: "discovery:new:sent",
              activityType: "sent",
              occurredAt: "2026-02-10T09:00:00.000Z",
              campaignId: "campaign-new",
              audienceId: "audience-new",
              memberId: "member-new",
            }),
          ]),
        );
      },
    );
    capture.mailchimp.captureTransitionBatch = captureTransitionBatch;

    const context = await createTestWorkerContext({
      capture,
      logger,
      mailchimpTransition: {
        enabled: true,
        discoverySeed: "2026-01-06T00:00:00.000Z",
      },
    });

    try {
      await seedTailState(context, {
        campaignId: "campaign-first-week",
        audienceId: "audience-existing",
        firstSeenSendTime: "2026-02-08T00:00:00.000Z",
        lastActivitySeenAt: "2026-02-09T10:00:00.000Z",
        lastPolledAt: "2026-02-10T11:45:00.000Z",
      });
      await seedTailState(context, {
        campaignId: "campaign-mature",
        audienceId: "audience-existing",
        firstSeenSendTime: "2026-01-25T00:00:00.000Z",
        lastActivitySeenAt: "2026-02-09T06:00:00.000Z",
        lastPolledAt: "2026-02-10T05:00:00.000Z",
      });
      await seedTailState(context, {
        campaignId: "campaign-too-soon",
        audienceId: "audience-existing",
        firstSeenSendTime: "2026-01-25T00:00:00.000Z",
        lastActivitySeenAt: "2026-02-10T08:30:00.000Z",
        lastPolledAt: "2026-02-10T08:00:00.000Z",
      });
      await seedTailState(context, {
        campaignId: "campaign-expired",
        audienceId: "audience-existing",
        firstSeenSendTime: "2026-01-05T00:00:00.000Z",
      });

      const task =
        createStage1TaskList(context.orchestration)[
          mailchimpTransitionSchedulerJobName
        ];

      expect(task).toBeTypeOf("function");
      if (task === undefined) {
        throw new Error("Expected Mailchimp transition scheduler task.");
      }

      const scheduledCampaignIds: string[] = [];
      const addJob = vi.fn(
        (
          _jobName: string,
          payload: Pick<MailchimpTransitionCaptureBatchPayload, "recordIds">,
        ) => {
          const campaignId = payload.recordIds[0];

          if (campaignId !== undefined) {
            scheduledCampaignIds.push(campaignId);
          }

          return Promise.resolve({
            id: `job:${String(scheduledCampaignIds.length)}`,
          });
        },
      );
      await task({}, { addJob } as never);

      expect(captureTransitionBatch).toHaveBeenCalledTimes(1);
      expect(captureTransitionBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          recordIds: [],
          windowStart: "2026-01-06T00:00:00.000Z",
          windowEnd: "2026-02-10T12:00:00.000Z",
        }),
      );

      expect(scheduledCampaignIds.sort()).toEqual([
        "campaign-first-week",
        "campaign-mature",
        "campaign-new",
      ]);

      const discoveryState = await context.repositories.syncState.findById(
        mailchimpTransitionDiscoverySyncStateId,
      );
      expect(discoveryState?.cursor).toBe("2026-02-10T09:00:00.000Z");

      const newCampaign = await context.mailchimpTailState.findByCampaignId(
        "campaign-new",
      );
      expect(newCampaign).toMatchObject({
        audienceId: "audience-new",
        firstSeenSendTime: "2026-02-10T09:00:00.000Z",
        lastActivitySeenAt: null,
        lastPolledAt: "2026-02-10T12:00:00.000Z",
        droppedAt: null,
      });

      const expiredCampaign = await context.mailchimpTailState.findByCampaignId(
        "campaign-expired",
      );
      expect(expiredCampaign?.droppedAt).toBe("2026-02-10T12:00:00.000Z");

      const tooSoonCampaign = await context.mailchimpTailState.findByCampaignId(
        "campaign-too-soon",
      );
      expect(tooSoonCampaign?.lastPolledAt).toBe("2026-02-10T08:00:00.000Z");

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "mailchimp.scheduler.discovery.completed",
          count: 1,
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "mailchimp.scheduler.refresh.scheduled",
          count: 3,
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "mailchimp.scheduler.refresh.dropped",
          count: 1,
        }),
      );
    } finally {
      await context.dispose();
    }
  });

  it("runs the scheduled transition job through ingest and advances the per-campaign tail cursor", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-10T12:00:00.000Z"));

    const capture = createEmptyCapturePorts();
    capture.mailchimp.captureTransitionBatch = vi.fn(
      (payload: MailchimpTransitionCaptureBatchPayload) => {
        if (payload.recordIds.length === 0) {
          return Promise.resolve(
            buildCapturedBatch<MailchimpRecord>([
              createMailchimpActivityRecord({
                recordId: "campaign-live:sent:discovery",
                activityType: "sent",
                occurredAt: "2026-02-10T09:00:00.000Z",
                campaignId: "campaign-live",
                audienceId: "audience-live",
                memberId: "member-live",
              }),
            ]),
          );
        }

        expect(payload.recordIds).toEqual(["campaign-live"]);

        return Promise.resolve(
          buildCapturedBatch<MailchimpRecord>(
            [
              createMailchimpActivityRecord({
                recordId: "campaign-live:sent",
                activityType: "sent",
                occurredAt: "2026-02-10T09:00:00.000Z",
                campaignId: "campaign-live",
                audienceId: "audience-live",
                memberId: "member-live",
              }),
              createMailchimpActivityRecord({
                recordId: "campaign-live:opened",
                activityType: "opened",
                occurredAt: "2026-02-10T10:00:00.000Z",
                campaignId: "campaign-live",
                audienceId: "audience-live",
                memberId: "member-live",
              }),
              createMailchimpActivityRecord({
                recordId: "campaign-live:clicked",
                activityType: "clicked",
                occurredAt: "2026-02-10T11:00:00.000Z",
                campaignId: "campaign-live",
                audienceId: "audience-live",
                memberId: "member-live",
              }),
              createMailchimpActivityRecord({
                recordId: "campaign-live:unsubscribed",
                activityType: "unsubscribed",
                occurredAt: "2026-02-10T11:30:00.000Z",
                campaignId: "campaign-live",
                audienceId: "audience-live",
                memberId: "member-live",
              }),
            ],
            {
              checkpoint: "2026-02-10T11:30:00.000Z",
            },
          ),
        );
      },
    );

    const context = await createTestWorkerContext({
      capture,
      mailchimpTransition: {
        enabled: true,
        discoverySeed: "2026-01-06T00:00:00.000Z",
      },
    });

    try {
      await seedKnownContact(context);

      const tasks = createStage1TaskList(context.orchestration);
      const schedulerTask = tasks[mailchimpTransitionSchedulerJobName];
      const transitionTask = tasks[mailchimpTransitionCaptureBatchJobName];

      expect(schedulerTask).toBeTypeOf("function");
      expect(transitionTask).toBeTypeOf("function");
      if (schedulerTask === undefined || transitionTask === undefined) {
        throw new Error("Expected Mailchimp transition tasks to be registered.");
      }

      const enqueuedJobs: {
        readonly jobName: string;
        readonly payload: unknown;
      }[] = [];
      const addJob = vi.fn((jobName: string, payload: unknown) => {
        enqueuedJobs.push({ jobName, payload });
        return Promise.resolve({ id: `job:${enqueuedJobs.length.toString()}` });
      });

      await schedulerTask({}, { addJob } as never);

      expect(enqueuedJobs).toHaveLength(1);
      expect(enqueuedJobs[0]?.jobName).toBe(mailchimpTransitionCaptureBatchJobName);

      await transitionTask(enqueuedJobs[0]?.payload, {} as never);

      const canonicalEvents = await context.repositories.canonicalEvents.listByContactId(
        "contact:mailchimp:known",
      );
      expect(canonicalEvents.map((event) => event.eventType).sort()).toEqual([
        "campaign.email.clicked",
        "campaign.email.opened",
        "campaign.email.sent",
        "campaign.email.unsubscribed",
      ]);

      const tailState = await context.mailchimpTailState.findByCampaignId(
        "campaign-live",
      );
      expect(tailState?.lastActivitySeenAt).toBe("2026-02-10T11:30:00.000Z");
    } finally {
      await context.dispose();
    }
  });
});
