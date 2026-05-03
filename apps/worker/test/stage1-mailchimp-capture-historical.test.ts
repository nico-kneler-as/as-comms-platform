import { describe, expect, it, vi } from "vitest";

import type { MailchimpRecord } from "@as-comms/integrations";

import {
  parseMailchimpHistoricalCaptureArgs,
  runMailchimpHistoricalCaptureCommand,
} from "../src/ops/mailchimp-capture-historical.js";

function buildMailchimpRecord(input: {
  readonly recordId: string;
  readonly campaignId: string;
  readonly occurredAt: string;
}): MailchimpRecord {
  return {
    recordType: "campaign_member_activity",
    recordId: input.recordId,
    activityType: "sent",
    occurredAt: input.occurredAt,
    receivedAt: "2026-05-03T12:00:00.000Z",
    payloadRef: `payloads/mailchimp/${input.recordId}.json`,
    checksum: `checksum:${input.recordId}`,
    normalizedEmail: "volunteer@example.org",
    salesforceContactId: null,
    volunteerIdPlainValues: [],
    normalizedPhones: [],
    campaignId: input.campaignId,
    audienceId: "aud-1",
    memberId: `member:${input.recordId}`,
    campaignName: `Campaign ${input.campaignId}`,
    snippet: "",
  };
}

function createCapturingLogger() {
  const lines: string[] = [];

  return {
    logger: {
      log: (...args: readonly unknown[]) => {
        lines.push(args.join(" "));
      },
      error: (...args: readonly unknown[]) => {
        lines.push(args.join(" "));
      },
    },
    lines,
  };
}

describe("Mailchimp historical capture ops command", () => {
  it("parses required flags and defaults to dry-run", () => {
    const parsed = parseMailchimpHistoricalCaptureArgs(
      ["--since=2026-04-03", "--limit-campaigns=2"],
      new Date("2026-05-03T12:00:00.000Z")
    );

    expect(parsed).toEqual({
      since: "2026-04-03T00:00:00.000Z",
      windowStart: "2026-04-03T00:00:00.000Z",
      windowEnd: "2026-05-03T12:00:00.000Z",
      dryRun: true,
      confirm: false,
      limitCampaigns: 2,
    });
  });

  it("logs the planned historical job sequence in dry-run mode", async () => {
    const { logger, lines } = createCapturingLogger();
    const captureHistoricalBatch = vi
      .fn()
      .mockResolvedValueOnce({
        records: [
          buildMailchimpRecord({
            recordId: "record-1",
            campaignId: "campaign-1",
            occurredAt: "2026-04-03T10:00:00.000Z",
          }),
        ],
        nextCursor: "cursor-2",
        checkpoint: "2026-04-03T10:00:00.000Z",
      })
      .mockResolvedValueOnce({
        records: [
          buildMailchimpRecord({
            recordId: "record-2",
            campaignId: "campaign-2",
            occurredAt: "2026-04-03T11:00:00.000Z",
          }),
        ],
        nextCursor: null,
        checkpoint: "2026-04-03T11:00:00.000Z",
      });

    const plan = await runMailchimpHistoricalCaptureCommand(
      ["--since=2026-04-03"],
      {},
      {
        now: new Date("2026-05-03T12:00:00.000Z"),
        logger,
        captureHistoricalBatch,
      }
    );

    expect(plan.jobs).toHaveLength(2);
    expect(lines).toEqual(
      expect.arrayContaining([
        "mailchimp-capture-historical",
        "Mode: dry-run",
        "- jobs planned: 2",
        "- expected records: 2",
        "Dry run complete. Re-run with --confirm to enqueue Mailchimp historical capture jobs.",
      ])
    );
  });

  it("enqueues the planned job sequence when --confirm is provided", async () => {
    const { logger } = createCapturingLogger();
    const captureHistoricalBatch = vi
      .fn()
      .mockResolvedValueOnce({
        records: [
          buildMailchimpRecord({
            recordId: "record-1",
            campaignId: "campaign-1",
            occurredAt: "2026-04-03T10:00:00.000Z",
          }),
        ],
        nextCursor: "cursor-2",
        checkpoint: "2026-04-03T10:00:00.000Z",
      })
      .mockResolvedValueOnce({
        records: [
          buildMailchimpRecord({
            recordId: "record-2",
            campaignId: "campaign-2",
            occurredAt: "2026-04-03T11:00:00.000Z",
          }),
        ],
        nextCursor: null,
        checkpoint: "2026-04-03T11:00:00.000Z",
      });
    const enqueuedPayloads: unknown[] = [];

    await runMailchimpHistoricalCaptureCommand(
      ["--since=2026-04-03", "--confirm"],
      {},
      {
        now: new Date("2026-05-03T12:00:00.000Z"),
        logger,
        captureHistoricalBatch,
        enqueueJob: (payload) => {
          enqueuedPayloads.push(payload);
          return Promise.resolve({
            enqueuedJobId: `job-${String(enqueuedPayloads.length)}`,
          });
        },
      }
    );

    expect(enqueuedPayloads).toHaveLength(2);
    expect(enqueuedPayloads[0]).toMatchObject({
      cursor: null,
      checkpoint: null,
      windowStart: "2026-04-03T00:00:00.000Z",
      windowEnd: "2026-05-03T12:00:00.000Z",
    });
    expect(enqueuedPayloads[1]).toMatchObject({
      cursor: "cursor-2",
      checkpoint: "2026-04-03T10:00:00.000Z",
      windowStart: "2026-04-03T00:00:00.000Z",
      windowEnd: "2026-05-03T12:00:00.000Z",
    });
    expect(
      (enqueuedPayloads[0] as { readonly correlationId: string }).correlationId
    ).toBe(
      (enqueuedPayloads[1] as { readonly correlationId: string }).correlationId
    );
    expect(
      (enqueuedPayloads[0] as { readonly syncStateId: string }).syncStateId
    ).toBe(
      (enqueuedPayloads[1] as { readonly syncStateId: string }).syncStateId
    );
  });
});
