import { randomUUID } from "node:crypto";

import {
  mailchimpTransitionCaptureBatchJobName,
  mailchimpTransitionCaptureBatchPayloadSchema,
  stage1JobVersion,
  type SyncStateRecord,
} from "@as-comms/contracts";
import { mailchimpCampaignActivityRecordSchema } from "@as-comms/integrations";
import type {
  MailchimpCampaignTailStateRepository,
  MailchimpCampaignTailStateRecord,
} from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";

import type { MailchimpCapturePort } from "./types.js";

const firstPhaseWindowMs = 7 * 24 * 60 * 60 * 1000;
const rotationWindowMs = 30 * 24 * 60 * 60 * 1000;
const matureCampaignRefreshIntervalMs = 6 * 60 * 60 * 1000;
const defaultDiscoveryBatchMaxRecords = 1000;

export const mailchimpTransitionSchedulerJobName =
  "stage1.mailchimp.transition.scheduler" as const;
export const mailchimpTransitionDiscoverySyncStateId =
  "sync:mailchimp:transition:discovery" as const;

export interface MailchimpTransitionSchedulerConfig {
  readonly enabled: boolean;
  readonly discoverySeed: string;
  readonly discoveryBatchMaxRecords?: number;
}

export interface MailchimpTransitionSchedulerTickInput {
  readonly addJob: (
    jobName: string,
    payload: unknown,
    spec?: {
      readonly maxAttempts?: number;
    },
  ) => Promise<unknown>;
  readonly now?: Date;
}

interface MailchimpTransitionSchedulerDependencies {
  readonly capture: MailchimpCapturePort;
  readonly syncState: Stage1RepositoryBundle["syncState"];
  readonly tailState: MailchimpCampaignTailStateRepository;
  readonly config: MailchimpTransitionSchedulerConfig;
  readonly logger?: Pick<Console, "info">;
}

interface DiscoveredCampaign {
  readonly campaignId: string;
  readonly audienceId: string;
  readonly sendTime: string;
}

function buildWorkerOperationId(prefix: string): string {
  return `${prefix}:${randomUUID()}`;
}

export function buildMailchimpTransitionSyncStateId(campaignId: string): string {
  return `sync:mailchimp:transition:${campaignId}`;
}

function compareDiscoveredCampaigns(
  left: DiscoveredCampaign,
  right: DiscoveredCampaign,
): number {
  if (left.sendTime !== right.sendTime) {
    return left.sendTime.localeCompare(right.sendTime);
  }

  return left.campaignId.localeCompare(right.campaignId);
}

function maxTimestamp(
  current: string | null,
  candidate: string,
): string {
  return current === null || candidate > current ? candidate : current;
}

function computeDiscoveryCursor(
  record: SyncStateRecord | null,
  seed: string,
): string {
  return record?.cursor ?? seed;
}

function shouldRefreshCampaign(
  campaign: MailchimpCampaignTailStateRecord,
  now: Date,
): boolean {
  const firstSeenMs = Date.parse(campaign.firstSeenSendTime);

  if (Number.isNaN(firstSeenMs)) {
    return false;
  }

  const ageMs = now.getTime() - firstSeenMs;

  if (ageMs <= firstPhaseWindowMs) {
    return true;
  }

  if (campaign.lastPolledAt === null) {
    return true;
  }

  const lastPolledMs = Date.parse(campaign.lastPolledAt);

  return (
    !Number.isNaN(lastPolledMs) &&
    now.getTime() - lastPolledMs >= matureCampaignRefreshIntervalMs
  );
}

function hasAgedOut(
  campaign: MailchimpCampaignTailStateRecord,
  now: Date,
): boolean {
  const firstSeenMs = Date.parse(campaign.firstSeenSendTime);

  return !Number.isNaN(firstSeenMs) && now.getTime() - firstSeenMs > rotationWindowMs;
}

async function saveDiscoverySyncState(
  syncState: Stage1RepositoryBundle["syncState"],
  input: {
    readonly cursor: string;
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly completedAt: string;
  },
): Promise<void> {
  const existing = await syncState.findById(mailchimpTransitionDiscoverySyncStateId);

  await syncState.upsert({
    id: mailchimpTransitionDiscoverySyncStateId,
    scope: "provider",
    provider: "mailchimp",
    jobType: "live_ingest",
    cursor: input.cursor,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    status: "succeeded",
    parityPercent: null,
    freshnessP95Seconds: null,
    freshnessP99Seconds: null,
    lastSuccessfulAt: input.completedAt,
    consecutiveFailureCount: 0,
    leaseOwner: null,
    heartbeatAt: null,
    deadLetterCount: existing?.deadLetterCount ?? 0,
  });
}

export function createMailchimpTransitionScheduler(
  input: MailchimpTransitionSchedulerDependencies,
): {
  runTick(params: MailchimpTransitionSchedulerTickInput): Promise<void>;
} {
  const logger = input.logger ?? console;
  const discoveryBatchMaxRecords =
    input.config.discoveryBatchMaxRecords ?? defaultDiscoveryBatchMaxRecords;

  return {
    async runTick(params) {
      if (!input.config.enabled) {
        logger.info("[mailchimp.scheduler] disabled");
        return;
      }

      const startedAt = params.now ?? new Date();
      const startedAtIso = startedAt.toISOString();
      logger.info({
        event: "mailchimp.scheduler.tick.started",
        timestamp: startedAtIso,
      });

      const discoveryState = await input.syncState.findById(
        mailchimpTransitionDiscoverySyncStateId,
      );
      const discoveryCursor = computeDiscoveryCursor(
        discoveryState,
        input.config.discoverySeed,
      );
      const discoveredCampaigns = new Map<string, DiscoveredCampaign>();
      let pageCursor: string | null = null;
      let latestDiscoveredSendTime: string | null = null;

      for (;;) {
        const batch = await input.capture.captureTransitionBatch(
          mailchimpTransitionCaptureBatchPayloadSchema.parse({
            version: stage1JobVersion,
            jobId: buildWorkerOperationId("stage1:mailchimp:transition:discovery:job"),
            correlationId: buildWorkerOperationId(
              "stage1:mailchimp:transition:discovery:correlation",
            ),
            batchId: buildWorkerOperationId(
              "stage1:mailchimp:transition:discovery:batch",
            ),
            syncStateId: mailchimpTransitionDiscoverySyncStateId,
            provider: "mailchimp",
            mode: "transition_live",
            jobType: "live_ingest",
            cursor: pageCursor,
            checkpoint: discoveryCursor,
            windowStart: discoveryCursor,
            windowEnd: startedAtIso,
            maxRecords: discoveryBatchMaxRecords,
            recordIds: [],
          }),
        );

        for (const rawRecord of batch.records) {
          const parsedRecord = mailchimpCampaignActivityRecordSchema.safeParse(rawRecord);

          if (!parsedRecord.success || parsedRecord.data.activityType !== "sent") {
            continue;
          }

          const campaign = {
            campaignId: parsedRecord.data.campaignId,
            audienceId: parsedRecord.data.audienceId,
            sendTime: parsedRecord.data.occurredAt,
          } satisfies DiscoveredCampaign;
          discoveredCampaigns.set(campaign.campaignId, campaign);
          latestDiscoveredSendTime = maxTimestamp(
            latestDiscoveredSendTime,
            campaign.sendTime,
          );
        }

        if (batch.nextCursor === null) {
          break;
        }

        pageCursor = batch.nextCursor;
      }

      let newCampaignCount = 0;
      const orderedDiscoveredCampaigns = [...discoveredCampaigns.values()].sort(
        compareDiscoveredCampaigns,
      );

      for (const campaign of orderedDiscoveredCampaigns) {
        const existing = await input.tailState.findByCampaignId(campaign.campaignId);

        if (existing === null) {
          newCampaignCount += 1;
        }

        await input.tailState.upsert({
          campaignId: campaign.campaignId,
          audienceId: campaign.audienceId,
          firstSeenSendTime: campaign.sendTime,
        });
      }

      await saveDiscoverySyncState(input.syncState, {
        cursor: latestDiscoveredSendTime ?? discoveryCursor,
        windowStart: discoveryCursor,
        windowEnd: startedAtIso,
        completedAt: startedAtIso,
      });
      logger.info({
        event: "mailchimp.scheduler.discovery.completed",
        count: newCampaignCount,
      });

      const activeCampaigns = await input.tailState.listActive();
      let jobsEnqueued = 0;
      let campaignsDropped = 0;

      for (const campaign of activeCampaigns) {
        if (hasAgedOut(campaign, startedAt)) {
          await input.tailState.markDropped({
            campaignId: campaign.campaignId,
            droppedAt: startedAtIso,
          });
          campaignsDropped += 1;
          continue;
        }

        const syncStateId = buildMailchimpTransitionSyncStateId(campaign.campaignId);
        const currentSyncState = await input.syncState.findById(syncStateId);

        if (currentSyncState?.status === "running") {
          continue;
        }

        if (!shouldRefreshCampaign(campaign, startedAt)) {
          continue;
        }

        await params.addJob(
          mailchimpTransitionCaptureBatchJobName,
          mailchimpTransitionCaptureBatchPayloadSchema.parse({
            version: stage1JobVersion,
            jobId: buildWorkerOperationId(
              "stage1:mailchimp:transition:capture:job",
            ),
            correlationId: buildWorkerOperationId(
              "stage1:mailchimp:transition:capture:correlation",
            ),
            batchId: buildWorkerOperationId(
              "stage1:mailchimp:transition:capture:batch",
            ),
            syncStateId,
            provider: "mailchimp",
            mode: "transition_live",
            jobType: "live_ingest",
            checkpoint: campaign.lastActivitySeenAt,
            windowStart: campaign.lastActivitySeenAt,
            windowEnd: startedAtIso,
            maxRecords: discoveryBatchMaxRecords,
            recordIds: [campaign.campaignId],
          }),
          {
            maxAttempts: 1,
          },
        );
        await input.tailState.markPolled({
          campaignId: campaign.campaignId,
          polledAt: startedAtIso,
        });
        jobsEnqueued += 1;
      }

      logger.info({
        event: "mailchimp.scheduler.refresh.scheduled",
        count: jobsEnqueued,
      });
      logger.info({
        event: "mailchimp.scheduler.refresh.dropped",
        count: campaignsDropped,
      });
      logger.info({
        event: "mailchimp.scheduler.tick.completed",
        durationMs: Date.now() - startedAt.getTime(),
      });
    },
  };
}
