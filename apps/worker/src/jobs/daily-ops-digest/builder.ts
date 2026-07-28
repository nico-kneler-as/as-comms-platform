import type {
  DailyOpsDigest,
  DailyOpsDigestBuildResult,
  DailyOpsDigestHighWaterMark,
  DailyOpsDigestObservedState,
  DailyOpsDigestSection,
  DailyOpsDigestSnapshot,
  DailyOpsDigestSyncStateSignal,
  DailyOpsDigestWatermarkState,
} from "./types.js";
import {
  dailyOpsDigestCategory,
  reviewQueueDailyBaselineMax,
  sourceEvidenceQuarantineThreshold,
  syncStateFailureConsecutiveThreshold,
  syncStateFailurePollIntervalMultiplier,
  weeklyQuietDays,
} from "./types.js";

const dayMs = 24 * 60 * 60 * 1000;

function toMillis(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pluralize(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function formatMinutes(seconds: number): string {
  const minutes = seconds / 60;
  return Number.isInteger(minutes)
    ? `${String(minutes)} minute${minutes === 1 ? "" : "s"}`
    : `${String(seconds)} seconds`;
}

function isAfterHighWaterMark(
  timestamp: string,
  id: string,
  marker: DailyOpsDigestHighWaterMark | null,
): boolean {
  if (marker === null) {
    return true;
  }

  if (timestamp > marker.timestamp) {
    return true;
  }

  if (timestamp < marker.timestamp) {
    return false;
  }

  return id > marker.id;
}

function maxHighWaterMark(
  entries: readonly {
    readonly id: string;
    readonly timestamp: string;
  }[],
): DailyOpsDigestHighWaterMark | null {
  let current: DailyOpsDigestHighWaterMark | null = null;

  for (const entry of entries) {
    if (
      current === null ||
      entry.timestamp > current.timestamp ||
      (entry.timestamp === current.timestamp && entry.id > current.id)
    ) {
      current = {
        id: entry.id,
        timestamp: entry.timestamp,
      };
    }
  }

  return current;
}

function buildObservedState(
  snapshot: DailyOpsDigestSnapshot,
): DailyOpsDigestObservedState {
  return {
    ...(snapshot.syncState.kind === "ok"
      ? {
          syncStateDeadLetterCounts: Object.fromEntries(
            snapshot.syncState.value.signals.map((signal) => [
              signal.provider,
              signal.deadLetterCount,
            ]),
          ),
        }
      : {}),
    ...(snapshot.postmarkWebhookDeadLetter.kind === "ok"
      ? {
          postmarkWebhookDeadLetter: maxHighWaterMark(
            snapshot.postmarkWebhookDeadLetter.value.rows.map((row) => ({
              id: row.id,
              timestamp: row.receivedAt,
            })),
          ),
        }
      : {}),
    ...(snapshot.reviewQueues.kind === "ok"
      ? {
          identityResolutionQueue: maxHighWaterMark(
            snapshot.reviewQueues.value.identityCases.map((entry) => ({
              id: entry.id,
              timestamp: entry.openedAt,
            })),
          ),
          routingReviewQueue: maxHighWaterMark(
            snapshot.reviewQueues.value.routingCases.map((entry) => ({
              id: entry.id,
              timestamp: entry.openedAt,
            })),
          ),
        }
      : {}),
  };
}

function buildGapSection(input: {
  readonly kind: DailyOpsDigestSection["kind"];
  readonly title: string;
  readonly detail: string;
  readonly linkTarget: DailyOpsDigestSection["linkTarget"];
}): DailyOpsDigestSection {
  return {
    kind: input.kind,
    tone: "gap",
    title: input.title,
    summary: `Could not check ${input.title.toLowerCase()}.`,
    baseline: null,
    details: [
      {
        label: "Gap",
        value: input.detail,
      },
    ],
    linkTarget: input.linkTarget,
  };
}

function shouldReportSyncFailure(
  signal: DailyOpsDigestSyncStateSignal,
  watermark: DailyOpsDigestWatermarkState | null,
  runAt: string,
): boolean {
  const runAtMs = toMillis(runAt);
  const lastSuccessfulAtMs = toMillis(signal.lastSuccessfulAt);

  if (runAtMs === null) {
    return false;
  }

  const thresholdMs =
    signal.pollIntervalSeconds *
    syncStateFailurePollIntervalMultiplier *
    1000;
  const missedWindow =
    lastSuccessfulAtMs === null
      ? true
      : runAtMs - lastSuccessfulAtMs >= thresholdMs;
  const failurePattern =
    missedWindow ||
    signal.consecutiveFailureCount >= syncStateFailureConsecutiveThreshold;

  if (!failurePattern) {
    return false;
  }

  const lastDigestSentAtMs = toMillis(watermark?.lastDigestSentAt ?? null);

  if (lastDigestSentAtMs === null) {
    return true;
  }

  if (signal.lastSuccessfulAt === null) {
    return false;
  }

  return lastSuccessfulAtMs !== null && lastSuccessfulAtMs > lastDigestSentAtMs;
}

function buildSyncStateSection(
  snapshot: DailyOpsDigestSnapshot,
  watermark: DailyOpsDigestWatermarkState | null,
): DailyOpsDigestSection | null {
  if (snapshot.syncState.kind === "gap") {
    return buildGapSection({
      kind: "sync_state",
      title: "Capture health",
      detail: snapshot.syncState.detail,
      linkTarget: "logs",
    });
  }

  const reportable = snapshot.syncState.value.signals.flatMap((signal) => {
    const deadLetterDelta =
      signal.deadLetterCount -
      (watermark?.syncStateDeadLetterCounts[signal.provider] ?? 0);
    const failure = shouldReportSyncFailure(signal, watermark, snapshot.runAt);

    if (!failure && deadLetterDelta <= 0) {
      return [];
    }

    const reasons: string[] = [];

    if (failure) {
      reasons.push(
        `${String(signal.consecutiveFailureCount)} consecutive failures and no success within ${formatMinutes(
          signal.pollIntervalSeconds * syncStateFailurePollIntervalMultiplier,
        )}`,
      );
    }

    if (deadLetterDelta > 0) {
      reasons.push(
        `dead letters ${String(signal.deadLetterCount)} (${deadLetterDelta > 0 ? "+" : ""}${String(
          deadLetterDelta,
        )} since last successful digest)`,
      );
    }

    return [
      {
        label: signal.label,
        value: reasons.join("; "),
      },
    ];
  });

  if (
    reportable.length === 0 &&
    snapshot.syncState.value.missingProviders.length === 0
  ) {
    return null;
  }

  const details = [...reportable];

  if (snapshot.syncState.value.missingProviders.length > 0) {
    details.push({
      label: "Missing state",
      value: snapshot.syncState.value.missingProviders.join(", "),
    });
  }

  return {
    kind: "sync_state",
    tone: snapshot.syncState.value.missingProviders.length > 0 ? "gap" : "alert",
    title: "Capture health",
    summary:
      reportable.length > 0
        ? `${pluralize(reportable.length, "capture signal")} crossed the digest threshold.`
        : "One or more live-capture states could not be checked.",
    baseline:
      "Expected a success at least every 3 poll intervals or fewer than 3 consecutive failures. Dead-letter counts should not increase.",
    details,
    linkTarget: "logs",
  };
}

function buildSourceEvidenceQuarantineSection(
  snapshot: DailyOpsDigestSnapshot,
): DailyOpsDigestSection | null {
  if (snapshot.sourceEvidenceQuarantine.kind === "gap") {
    return buildGapSection({
      kind: "source_evidence_quarantine",
      title: "Duplicate-collision quarantine",
      detail: snapshot.sourceEvidenceQuarantine.detail,
      linkTarget: "logs",
    });
  }

  const dayCount = snapshot.sourceEvidenceQuarantine.value.dayCount;

  if (dayCount <= sourceEvidenceQuarantineThreshold) {
    return null;
  }

  return {
    kind: "source_evidence_quarantine",
    tone: "alert",
    title: "Duplicate-collision quarantine",
    summary: `${pluralize(dayCount, "quarantine event")} landed in the daily window.`,
    baseline:
      "Normal volume is 1-3 per day; report once the day count is greater than 20.",
    details: [
      {
        label: "Window count",
        value: String(dayCount),
      },
    ],
    linkTarget: "logs",
  };
}

function buildPostmarkSection(
  snapshot: DailyOpsDigestSnapshot,
  watermark: DailyOpsDigestWatermarkState | null,
): DailyOpsDigestSection | null {
  if (snapshot.postmarkWebhookDeadLetter.kind === "gap") {
    return buildGapSection({
      kind: "postmark_webhook_dead_letter",
      title: "Postmark webhook dead letters",
      detail: snapshot.postmarkWebhookDeadLetter.detail,
      linkTarget: "logs",
    });
  }

  const newRows = snapshot.postmarkWebhookDeadLetter.value.rows.filter((row) =>
    isAfterHighWaterMark(
      row.receivedAt,
      row.id,
      watermark?.postmarkWebhookDeadLetter ?? null,
    ),
  );

  if (newRows.length === 0) {
    return null;
  }

  const retryableCount = newRows.filter((row) => row.status !== "terminal")
    .length;
  const terminalCount = newRows.length - retryableCount;

  return {
    kind: "postmark_webhook_dead_letter",
    tone: "alert",
    title: "Postmark webhook dead letters",
    summary: `${pluralize(newRows.length, "new dead-letter row")} arrived in the digest window.`,
    baseline: "Baseline is zero new rows; report any new retryable or terminal dead letters.",
    details: [
      {
        label: "Retryable",
        value: String(retryableCount),
      },
      {
        label: "Terminal",
        value: String(terminalCount),
      },
    ],
    linkTarget: "logs",
  };
}

function buildPendingComposerSection(
  snapshot: DailyOpsDigestSnapshot,
): DailyOpsDigestSection | null {
  if (snapshot.pendingComposerOutbounds.kind === "gap") {
    return buildGapSection({
      kind: "pending_composer_outbounds",
      title: "Composer outbounds",
      detail: snapshot.pendingComposerOutbounds.detail,
      linkTarget: "logs",
    });
  }

  const { failedCount, orphanedCount } = snapshot.pendingComposerOutbounds.value;
  const total = failedCount + orphanedCount;

  if (total === 0) {
    return null;
  }

  return {
    kind: "pending_composer_outbounds",
    tone: "alert",
    title: "Composer outbounds",
    summary: `${pluralize(total, "composer outbound")} failed or became orphaned in the window.`,
    baseline: "Baseline is zero; report any failed or orphaned composer outbound.",
    details: [
      {
        label: "Failed",
        value: String(failedCount),
      },
      {
        label: "Orphaned",
        value: String(orphanedCount),
      },
    ],
    linkTarget: "logs",
  };
}

function buildSmsSection(
  snapshot: DailyOpsDigestSnapshot,
): DailyOpsDigestSection | null {
  if (snapshot.smsMessages.kind === "gap") {
    return buildGapSection({
      kind: "sms_messages",
      title: "SMS sends",
      detail: snapshot.smsMessages.detail,
      linkTarget: "logs",
    });
  }

  const { failedCount, undeliveredCount } = snapshot.smsMessages.value;
  const total = failedCount + undeliveredCount;

  if (total === 0) {
    return null;
  }

  return {
    kind: "sms_messages",
    tone: "alert",
    title: "SMS sends",
    summary: `${pluralize(total, "SMS send")} failed or were marked undelivered in the window.`,
    baseline: "Baseline is zero; report any failed or undelivered SMS send.",
    details: [
      {
        label: "Failed",
        value: String(failedCount),
      },
      {
        label: "Undelivered",
        value: String(undeliveredCount),
      },
    ],
    linkTarget: "logs",
  };
}

function buildIntegrationHealthSection(
  snapshot: DailyOpsDigestSnapshot,
  watermark: DailyOpsDigestWatermarkState | null,
): DailyOpsDigestSection | null {
  if (snapshot.integrationHealth.kind === "gap") {
    return buildGapSection({
      kind: "integration_health",
      title: "Integration health",
      detail: snapshot.integrationHealth.detail,
      linkTarget: "integrations",
    });
  }

  const lastDigestSentAtMs = toMillis(watermark?.lastDigestSentAt ?? null);
  const reportable = snapshot.integrationHealth.value.rows
    .filter(
      (row) => row.status === "needs_attention" || row.status === "disconnected",
    )
    .filter((row) => {
      if (lastDigestSentAtMs === null) {
        return true;
      }

      const degradedSinceAtMs = toMillis(row.degradedSinceAt);

      return degradedSinceAtMs !== null && degradedSinceAtMs > lastDigestSentAtMs;
    });

  if (reportable.length === 0) {
    return null;
  }

  return {
    kind: "integration_health",
    tone: "alert",
    title: "Integration health",
    summary: `${pluralize(reportable.length, "integration")} is degraded or unreachable right now.`,
    baseline:
      "Baseline is healthy. Permanently not_configured integrations never report here.",
    details: reportable
      .sort((left, right) => left.serviceName.localeCompare(right.serviceName))
      .map((row) => ({
        label: row.serviceName,
        value: row.status,
      })),
    linkTarget: "integrations",
  };
}

function buildReviewQueueSection(
  snapshot: DailyOpsDigestSnapshot,
  watermark: DailyOpsDigestWatermarkState | null,
): DailyOpsDigestSection | null {
  if (snapshot.reviewQueues.kind === "gap") {
    return buildGapSection({
      kind: "review_queues",
      title: "Review queues",
      detail: snapshot.reviewQueues.detail,
      linkTarget: "logs",
    });
  }

  const newIdentityCases = snapshot.reviewQueues.value.identityCases.filter(
    (entry) =>
      isAfterHighWaterMark(
        entry.openedAt,
        entry.id,
        watermark?.identityResolutionQueue ?? null,
      ),
  );
  const newRoutingCases = snapshot.reviewQueues.value.routingCases.filter(
    (entry) =>
      isAfterHighWaterMark(
        entry.openedAt,
        entry.id,
        watermark?.routingReviewQueue ?? null,
      ),
  );
  const total = newIdentityCases.length + newRoutingCases.length;

  if (total <= reviewQueueDailyBaselineMax) {
    return null;
  }

  return {
    kind: "review_queues",
    tone: "alert",
    title: "Review queues",
    summary: `${pluralize(total, "new review case")} exceeded the recent daily baseline.`,
    baseline: `Recent daily counts run 1-${String(
      reviewQueueDailyBaselineMax,
    )}; report above that range.`,
    details: [
      {
        label: "Identity",
        value: String(newIdentityCases.length),
      },
      {
        label: "Routing",
        value: String(newRoutingCases.length),
      },
    ],
    linkTarget: "logs",
  };
}

function buildAllQuietDigest(snapshot: DailyOpsDigestSnapshot): DailyOpsDigest {
  return {
    kind: "all_quiet",
    dedupKey: `${dailyOpsDigestCategory}:${snapshot.digestDateDenver}`,
    digestDateDenver: snapshot.digestDateDenver,
    runAt: snapshot.runAt,
    window: snapshot.window,
    summary:
      "The daily ops digest checks are running and everything stayed within bounds for the last 7 quiet days.",
    sections: [],
  };
}

export function buildDailyOpsDigest(input: {
  readonly snapshot: DailyOpsDigestSnapshot;
  readonly watermark: DailyOpsDigestWatermarkState | null;
}): DailyOpsDigestBuildResult {
  const observedState = buildObservedState(input.snapshot);
  const sections = [
    buildSyncStateSection(input.snapshot, input.watermark),
    buildSourceEvidenceQuarantineSection(input.snapshot),
    buildPostmarkSection(input.snapshot, input.watermark),
    buildPendingComposerSection(input.snapshot),
    buildSmsSection(input.snapshot),
    buildIntegrationHealthSection(input.snapshot, input.watermark),
    buildReviewQueueSection(input.snapshot, input.watermark),
  ].filter((section): section is DailyOpsDigestSection => section !== null);

  if (sections.length > 0) {
    return {
      kind: "digest",
      digest: {
        kind: "issues",
        dedupKey: `${dailyOpsDigestCategory}:${input.snapshot.digestDateDenver}`,
        digestDateDenver: input.snapshot.digestDateDenver,
        runAt: input.snapshot.runAt,
        window: input.snapshot.window,
        summary: `${pluralize(sections.length, "section")} need attention.`,
        sections,
      },
      observedState,
    };
  }

  const quietStreakStartedAtMs = toMillis(
    input.watermark?.quietStreakStartedAt ?? null,
  );
  const runAtMs = toMillis(input.snapshot.runAt);

  if (
    quietStreakStartedAtMs !== null &&
    runAtMs !== null &&
    runAtMs - quietStreakStartedAtMs >= weeklyQuietDays * dayMs
  ) {
    return {
      kind: "digest",
      digest: buildAllQuietDigest(input.snapshot),
      observedState,
    };
  }

  return {
    kind: "nothing_to_report",
    observedState,
  };
}
