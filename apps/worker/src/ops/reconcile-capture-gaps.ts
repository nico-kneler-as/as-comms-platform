import { randomUUID } from "node:crypto";

import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";

import {
  gmailLiveCaptureBatchPayloadSchema,
  salesforceLiveCaptureBatchPayloadSchema,
  stage1JobVersion,
  type Provider,
} from "@as-comms/contracts";
import { syncState, type Stage1Database } from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";

const defaultLookbackDays = 7;
const defaultMinimumAgeMinutes = 5;
const defaultMaxRecoveryWindowMinutes = 120;
const defaultMaxRecoveriesPerRun = 50;
const captureGapRecoveryPolicyCode = "stage1.capture_gap.recovery";

export type CaptureGapRecoveryProvider = "gmail" | "salesforce";

export interface CaptureGapRecoveryPlan {
  readonly provider: CaptureGapRecoveryProvider;
  readonly sourceSyncStateIds: readonly string[];
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly payload: unknown;
}

export interface CaptureGapRecoveryError {
  readonly provider: CaptureGapRecoveryProvider | "mailchimp";
  readonly sourceSyncStateIds: readonly string[];
  readonly message: string;
}

export interface CaptureGapRecoveryReport {
  readonly scanned: number;
  readonly covered: number;
  readonly skipped: number;
  readonly planned: readonly CaptureGapRecoveryPlan[];
  readonly scheduled: number;
  readonly mailchimpSchedulerScheduled: boolean;
  readonly errors: readonly CaptureGapRecoveryError[];
  readonly auditEvidenceId: string | null;
}

interface CandidateWindow {
  readonly provider: CaptureGapRecoveryProvider;
  readonly syncStateId: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly cursor: string | null;
  readonly checkpoint: string | null;
}

interface CoalescedWindow {
  readonly provider: CaptureGapRecoveryProvider;
  readonly sourceSyncStateIds: readonly string[];
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly cursor: string | null;
  readonly checkpoint: string | null;
}

interface SucceededWindow {
  readonly provider: CaptureGapRecoveryProvider;
  readonly windowStart: Date;
  readonly windowEnd: Date;
}

interface ReconcileCaptureGapsDependencies {
  readonly db: Stage1Database;
  readonly repositories: Stage1RepositoryBundle;
  readonly now?: () => Date;
  readonly lookbackDays?: number;
  readonly minimumAgeMinutes?: number;
  readonly maxRecoveryWindowMinutes?: number;
  readonly maxRecoveriesPerRun?: number;
  readonly includeMailchimpScheduler?: boolean;
  readonly scheduleRecovery: (plan: CaptureGapRecoveryPlan) => Promise<void>;
  readonly scheduleMailchimpTransition?: () => Promise<void>;
  readonly logger?: Pick<Console, "log">;
}

function subtractMs(date: Date, ms: number): Date {
  return new Date(date.getTime() - ms);
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

function buildOperationId(prefix: string): string {
  return `${prefix}:${randomUUID()}`;
}

function isRecoveryProvider(provider: Provider | null): provider is CaptureGapRecoveryProvider {
  return provider === "gmail" || provider === "salesforce";
}

function isWindowCovered(
  candidate: CandidateWindow,
  succeededWindows: readonly SucceededWindow[]
): boolean {
  return succeededWindows.some(
    (window) =>
      window.provider === candidate.provider &&
      window.windowStart <= candidate.windowStart &&
      window.windowEnd >= candidate.windowEnd
  );
}

function coalesceCandidateWindows(
  candidates: readonly CandidateWindow[]
): readonly CoalescedWindow[] {
  const ordered = [...candidates].sort((left, right) => {
    const providerOrder = left.provider.localeCompare(right.provider);

    if (providerOrder !== 0) {
      return providerOrder;
    }

    return left.windowStart.getTime() - right.windowStart.getTime();
  });
  const coalesced: CoalescedWindow[] = [];

  for (const candidate of ordered) {
    const current = coalesced.at(-1);

    if (
      current?.provider !== candidate.provider ||
      candidate.windowStart > current.windowEnd
    ) {
      coalesced.push({
        provider: candidate.provider,
        sourceSyncStateIds: [candidate.syncStateId],
        windowStart: candidate.windowStart,
        windowEnd: candidate.windowEnd,
        cursor: candidate.cursor,
        checkpoint: candidate.checkpoint
      });
      continue;
    }

    coalesced[coalesced.length - 1] = {
      ...current,
      sourceSyncStateIds: [...current.sourceSyncStateIds, candidate.syncStateId],
      windowEnd:
        candidate.windowEnd > current.windowEnd ? candidate.windowEnd : current.windowEnd
    };
  }

  return coalesced;
}

function splitWindow(
  window: CoalescedWindow,
  maxWindowMs: number
): readonly CoalescedWindow[] {
  if (window.windowEnd.getTime() - window.windowStart.getTime() <= maxWindowMs) {
    return [window];
  }

  const chunks: CoalescedWindow[] = [];
  let chunkStart = window.windowStart;

  while (chunkStart < window.windowEnd) {
    const chunkEnd = new Date(
      Math.min(addMs(chunkStart, maxWindowMs).getTime(), window.windowEnd.getTime())
    );
    chunks.push({
      ...window,
      windowStart: chunkStart,
      windowEnd: chunkEnd
    });
    chunkStart = chunkEnd;
  }

  return chunks;
}

function buildRecoveryPayload(window: CoalescedWindow): unknown {
  const windowStart = window.windowStart.toISOString();
  const windowEnd = window.windowEnd.toISOString();

  if (window.provider === "gmail") {
    return gmailLiveCaptureBatchPayloadSchema.parse({
      version: stage1JobVersion,
      jobId: buildOperationId("stage1:gmail:gap-recovery:job"),
      correlationId: buildOperationId("stage1:gmail:gap-recovery:correlation"),
      batchId: buildOperationId("stage1:gmail:gap-recovery:batch"),
      syncStateId: buildOperationId("stage1:gmail:gap-recovery:sync-state"),
      provider: "gmail",
      mode: "live",
      jobType: "live_ingest",
      cursor: null,
      checkpoint: window.checkpoint ?? window.cursor ?? windowStart,
      windowStart,
      windowEnd,
      maxRecords: 1000
    });
  }

  return salesforceLiveCaptureBatchPayloadSchema.parse({
    version: stage1JobVersion,
    jobId: buildOperationId("stage1:salesforce:gap-recovery:job"),
    correlationId: buildOperationId("stage1:salesforce:gap-recovery:correlation"),
    batchId: buildOperationId("stage1:salesforce:gap-recovery:batch"),
    syncStateId: buildOperationId("stage1:salesforce:gap-recovery:sync-state"),
    provider: "salesforce",
    mode: "live",
    jobType: "live_ingest",
    cursor: null,
    checkpoint: window.checkpoint ?? window.cursor ?? windowStart,
    windowStart,
    windowEnd,
    maxRecords: 1000
  });
}

export async function reconcileCaptureGaps(
  dependencies: ReconcileCaptureGapsDependencies
): Promise<CaptureGapRecoveryReport> {
  const now = dependencies.now ?? (() => new Date());
  const logger = dependencies.logger ?? console;
  const evaluatedAt = now();
  const lookbackDays = dependencies.lookbackDays ?? defaultLookbackDays;
  const minimumAgeMinutes =
    dependencies.minimumAgeMinutes ?? defaultMinimumAgeMinutes;
  const maxRecoveryWindowMinutes =
    dependencies.maxRecoveryWindowMinutes ?? defaultMaxRecoveryWindowMinutes;
  const maxRecoveriesPerRun =
    dependencies.maxRecoveriesPerRun ?? defaultMaxRecoveriesPerRun;
  const includeMailchimpScheduler =
    dependencies.includeMailchimpScheduler ?? true;
  const lookbackStart = subtractMs(evaluatedAt, lookbackDays * 24 * 60 * 60 * 1000);
  const newestRecoverableWindowEnd = subtractMs(
    evaluatedAt,
    minimumAgeMinutes * 60 * 1000
  );
  const maxRecoveryWindowMs = maxRecoveryWindowMinutes * 60 * 1000;

  const [failedRows, succeededRows] = await Promise.all([
    dependencies.db
      .select()
      .from(syncState)
      .where(
        and(
          eq(syncState.scope, "provider"),
          eq(syncState.jobType, "live_ingest"),
          inArray(syncState.provider, ["gmail", "salesforce"]),
          inArray(syncState.status, ["failed", "quarantined"]),
          isNotNull(syncState.windowStart),
          isNotNull(syncState.windowEnd),
          gte(syncState.windowEnd, lookbackStart),
          lt(syncState.windowEnd, newestRecoverableWindowEnd)
        )
      ),
    dependencies.db
      .select()
      .from(syncState)
      .where(
        and(
          eq(syncState.scope, "provider"),
          eq(syncState.jobType, "live_ingest"),
          inArray(syncState.provider, ["gmail", "salesforce"]),
          eq(syncState.status, "succeeded"),
          isNotNull(syncState.windowStart),
          isNotNull(syncState.windowEnd),
          gte(syncState.windowEnd, lookbackStart)
        )
      )
  ]);

  const candidates: CandidateWindow[] = failedRows
    .filter((row): row is typeof row & {
      provider: CaptureGapRecoveryProvider;
      windowStart: Date;
      windowEnd: Date;
    } => isRecoveryProvider(row.provider) && row.windowStart !== null && row.windowEnd !== null)
    .filter((row) => row.windowStart < row.windowEnd)
    .map((row) => ({
      provider: row.provider,
      syncStateId: row.id,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
      cursor: row.cursor,
      checkpoint: row.cursor
    }));
  const succeededWindows: SucceededWindow[] = succeededRows
    .filter((row): row is typeof row & {
      provider: CaptureGapRecoveryProvider;
      windowStart: Date;
      windowEnd: Date;
    } => isRecoveryProvider(row.provider) && row.windowStart !== null && row.windowEnd !== null)
    .map((row) => ({
      provider: row.provider,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd
    }));
  const uncoveredCandidates = candidates.filter(
    (candidate) => !isWindowCovered(candidate, succeededWindows)
  );
  const covered = candidates.length - uncoveredCandidates.length;
  const recoveryWindows = coalesceCandidateWindows(uncoveredCandidates).flatMap(
    (window) => splitWindow(window, maxRecoveryWindowMs)
  );
  const plannedWindows = recoveryWindows.slice(0, maxRecoveriesPerRun);
  const skipped = recoveryWindows.length - plannedWindows.length;
  const planned = plannedWindows.map((window) => ({
    provider: window.provider,
    sourceSyncStateIds: window.sourceSyncStateIds,
    windowStart: window.windowStart.toISOString(),
    windowEnd: window.windowEnd.toISOString(),
    payload: buildRecoveryPayload(window)
  }));
  const errors: CaptureGapRecoveryError[] = [];
  let scheduled = 0;
  let mailchimpSchedulerScheduled = false;

  for (const plan of planned) {
    try {
      await dependencies.scheduleRecovery(plan);
      scheduled += 1;
    } catch (error) {
      errors.push({
        provider: plan.provider,
        sourceSyncStateIds: plan.sourceSyncStateIds,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (
    includeMailchimpScheduler &&
    dependencies.scheduleMailchimpTransition !== undefined
  ) {
    try {
      await dependencies.scheduleMailchimpTransition();
      mailchimpSchedulerScheduled = true;
    } catch (error) {
      errors.push({
        provider: "mailchimp",
        sourceSyncStateIds: [],
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const auditEvidence = await dependencies.repositories.auditEvidence.append({
    id: `audit:capture-gap-recovery:${String(Date.parse(evaluatedAt.toISOString()))}:${randomUUID()}`,
    actorType: "worker",
    actorId: "capture-gap-reconciler",
    action: "reconcile_capture_gaps",
    entityType: "capture_gap_recovery",
    entityId: evaluatedAt.toISOString().slice(0, 10),
    occurredAt: evaluatedAt.toISOString(),
    result: "recorded",
    policyCode: captureGapRecoveryPolicyCode,
    metadataJson: {
      scanned: candidates.length,
      covered,
      skipped,
      scheduled,
      planned: planned.map((plan) => ({
        provider: plan.provider,
        sourceSyncStateIds: plan.sourceSyncStateIds,
        windowStart: plan.windowStart,
        windowEnd: plan.windowEnd
      })),
      mailchimpSchedulerScheduled,
      errors: errors.length
    }
  });
  const report: CaptureGapRecoveryReport = {
    scanned: candidates.length,
    covered,
    skipped,
    planned,
    scheduled,
    mailchimpSchedulerScheduled,
    errors,
    auditEvidenceId: auditEvidence.id
  };

  logger.log(
    JSON.stringify({
      event: "capture_gap_recovery.completed",
      scanned: report.scanned,
      covered: report.covered,
      skipped: report.skipped,
      scheduled: report.scheduled,
      mailchimpSchedulerScheduled: report.mailchimpSchedulerScheduled,
      errors: report.errors.length
    })
  );

  return report;
}
