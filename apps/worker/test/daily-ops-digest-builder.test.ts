import { describe, expect, it } from "vitest";

import { buildDailyOpsDigest } from "../src/jobs/daily-ops-digest/builder.js";
import type {
  DailyOpsDigestSignal,
  DailyOpsDigestSnapshot,
  DailyOpsDigestWatermarkState,
} from "../src/jobs/daily-ops-digest/types.js";
import { dailyOpsDigestTimeZone } from "../src/jobs/daily-ops-digest/types.js";

function ok<T>(value: T): DailyOpsDigestSignal<T> {
  return {
    kind: "ok",
    value,
  };
}

function gap(detail: string): DailyOpsDigestSignal<never> {
  return {
    kind: "gap",
    detail,
  };
}

function makeSnapshot(
  overrides: Partial<DailyOpsDigestSnapshot> = {},
): DailyOpsDigestSnapshot {
  return {
    runAt: "2026-07-27T13:00:00.000Z",
    digestDateDenver: "2026-07-27",
    window: {
      startsAt: "2026-07-26T06:00:00.000Z",
      endsAt: "2026-07-27T06:00:00.000Z",
      labelDateDenver: "2026-07-26",
      timeZone: dailyOpsDigestTimeZone,
    },
    syncState: ok({
      signals: [
        {
          provider: "gmail",
          label: "gmail live ingest",
          pollIntervalSeconds: 60,
          status: "succeeded",
          consecutiveFailureCount: 0,
          lastSuccessfulAt: "2026-07-27T12:59:00.000Z",
          deadLetterCount: 0,
        },
        {
          provider: "salesforce",
          label: "salesforce live ingest",
          pollIntervalSeconds: 300,
          status: "succeeded",
          consecutiveFailureCount: 0,
          lastSuccessfulAt: "2026-07-27T12:55:00.000Z",
          deadLetterCount: 0,
        },
      ],
      missingProviders: [],
    }),
    sourceEvidenceQuarantine: ok({
      dayCount: 3,
    }),
    postmarkWebhookDeadLetter: ok({
      rows: [],
    }),
    pendingComposerOutbounds: ok({
      failedCount: 0,
      orphanedCount: 0,
    }),
    smsMessages: ok({
      failedCount: 0,
      undeliveredCount: 0,
    }),
    integrationHealth: ok({
      rows: [
        {
          id: "gmail",
          serviceName: "gmail",
          status: "healthy",
          degradedSinceAt: null,
          updatedAt: "2026-07-27T13:00:00.000Z",
        },
        {
          id: "salesforce",
          serviceName: "salesforce",
          status: "healthy",
          degradedSinceAt: null,
          updatedAt: "2026-07-27T13:00:00.000Z",
        },
        {
          id: "simpletexting",
          serviceName: "simpletexting",
          status: "not_configured",
          degradedSinceAt: null,
          updatedAt: "2026-07-27T13:00:00.000Z",
        },
        {
          id: "openai",
          serviceName: "openai",
          status: "not_configured",
          degradedSinceAt: null,
          updatedAt: "2026-07-27T13:00:00.000Z",
        },
      ],
    }),
    reviewQueues: ok({
      identityCases: [],
      routingCases: [],
    }),
    dependencyAudit: null,
    ...overrides,
  };
}

function makeWatermark(
  overrides: Partial<DailyOpsDigestWatermarkState> = {},
): DailyOpsDigestWatermarkState {
  return {
    lastRunAt: "2026-07-26T13:00:00.000Z",
    lastDigestSentAt: "2026-07-26T13:00:00.000Z",
    quietStreakStartedAt: null,
    syncStateDeadLetterCounts: {
      gmail: 0,
      salesforce: 0,
    },
    postmarkWebhookDeadLetter: null,
    identityResolutionQueue: null,
    routingReviewQueue: null,
    ...overrides,
  };
}

describe("daily ops digest builder", () => {
  it("returns nothing to report for the all-quiet case", () => {
    const result = buildDailyOpsDigest({
      snapshot: makeSnapshot(),
      watermark: makeWatermark(),
    });

    expect(result.kind).toBe("nothing_to_report");
  });

  it("reports sync-state failures above threshold and stays quiet below threshold", () => {
    const belowThreshold = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        syncState: ok({
          signals: [
            {
              provider: "gmail",
              label: "gmail live ingest",
              pollIntervalSeconds: 60,
              status: "failed",
              consecutiveFailureCount: 2,
              lastSuccessfulAt: "2026-07-27T12:58:00.000Z",
              deadLetterCount: 0,
            },
          ],
          missingProviders: [],
        }),
      }),
      watermark: makeWatermark(),
    });

    expect(belowThreshold.kind).toBe("nothing_to_report");

    const aboveThreshold = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        syncState: ok({
          signals: [
            {
              provider: "gmail",
              label: "gmail live ingest",
              pollIntervalSeconds: 60,
              status: "failed",
              consecutiveFailureCount: 3,
              lastSuccessfulAt: "2026-07-27T12:56:00.000Z",
              deadLetterCount: 0,
            },
          ],
          missingProviders: [],
        }),
      }),
      watermark: makeWatermark({
        lastDigestSentAt: "2026-07-27T12:00:00.000Z",
      }),
    });

    expect(aboveThreshold.kind).toBe("digest");
    if (aboveThreshold.kind !== "digest") {
      throw new Error("Expected a digest.");
    }

    expect(aboveThreshold.digest.sections[0]?.kind).toBe("sync_state");
  });

  it("reports source-evidence quarantine at 21 and the historical spikes, but not at 20", () => {
    const atThreshold = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        sourceEvidenceQuarantine: ok({
          dayCount: 20,
        }),
      }),
      watermark: makeWatermark(),
    });

    expect(atThreshold.kind).toBe("nothing_to_report");

    for (const dayCount of [21, 45, 54]) {
      const result = buildDailyOpsDigest({
        snapshot: makeSnapshot({
          sourceEvidenceQuarantine: ok({
            dayCount,
          }),
        }),
        watermark: makeWatermark(),
      });

      expect(result.kind).toBe("digest");
      if (result.kind !== "digest") {
        throw new Error("Expected a digest.");
      }

      expect(result.digest.sections[0]).toMatchObject({
        kind: "source_evidence_quarantine",
        summary: `${String(dayCount)} quarantine events landed in the daily window.`,
      });
    }
  });

  it("reports new postmark dead letters once and suppresses rows already seen in the watermark", () => {
    const result = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        postmarkWebhookDeadLetter: ok({
          rows: [
            {
              id: "0001",
              receivedAt: "2026-07-26T08:00:00.000Z",
              status: "pending",
            },
            {
              id: "0002",
              receivedAt: "2026-07-26T09:00:00.000Z",
              status: "terminal",
            },
          ],
        }),
      }),
      watermark: makeWatermark({
        postmarkWebhookDeadLetter: {
          id: "0001",
          timestamp: "2026-07-26T08:00:00.000Z",
        },
      }),
    });

    expect(result.kind).toBe("digest");
    if (result.kind !== "digest") {
      throw new Error("Expected a digest.");
    }

    expect(result.digest.sections[0]).toMatchObject({
      kind: "postmark_webhook_dead_letter",
      details: [
        { label: "Retryable", value: "0" },
        { label: "Terminal", value: "1" },
      ],
    });

    const duplicateOnly = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        postmarkWebhookDeadLetter: ok({
          rows: [
            {
              id: "0001",
              receivedAt: "2026-07-26T08:00:00.000Z",
              status: "pending",
            },
          ],
        }),
      }),
      watermark: makeWatermark({
        postmarkWebhookDeadLetter: {
          id: "0001",
          timestamp: "2026-07-26T08:00:00.000Z",
        },
      }),
    });

    expect(duplicateOnly.kind).toBe("nothing_to_report");
  });

  it("reports composer failures and orphaned rows on a single occurrence", () => {
    const result = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        pendingComposerOutbounds: ok({
          failedCount: 1,
          orphanedCount: 0,
        }),
      }),
      watermark: makeWatermark(),
    });

    expect(result.kind).toBe("digest");
    if (result.kind !== "digest") {
      throw new Error("Expected a digest.");
    }

    expect(result.digest.sections[0]).toMatchObject({
      kind: "pending_composer_outbounds",
      details: [
        { label: "Failed", value: "1" },
        { label: "Orphaned", value: "0" },
      ],
    });
  });

  it("reports SMS failures on a single occurrence", () => {
    const result = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        smsMessages: ok({
          failedCount: 0,
          undeliveredCount: 1,
        }),
      }),
      watermark: makeWatermark(),
    });

    expect(result.kind).toBe("digest");
    if (result.kind !== "digest") {
      throw new Error("Expected a digest.");
    }

    expect(result.digest.sections[0]).toMatchObject({
      kind: "sms_messages",
      details: [
        { label: "Failed", value: "0" },
        { label: "Undelivered", value: "1" },
      ],
    });
  });

  it("never reports permanently not_configured integrations", () => {
    const result = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        integrationHealth: ok({
          rows: [
            {
              id: "simpletexting",
              serviceName: "simpletexting",
              status: "not_configured",
              degradedSinceAt: null,
              updatedAt: "2026-07-27T13:00:00.000Z",
            },
            {
              id: "openai",
              serviceName: "openai",
              status: "not_configured",
              degradedSinceAt: null,
              updatedAt: "2026-07-27T13:00:00.000Z",
            },
          ],
        }),
      }),
      watermark: makeWatermark(),
    });

    expect(result.kind).toBe("nothing_to_report");
  });

  it("reports degraded integrations only when the degradation is new since the last digest", () => {
    const stale = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        integrationHealth: ok({
          rows: [
            {
              id: "gmail",
              serviceName: "gmail",
              status: "needs_attention",
              degradedSinceAt: "2026-07-26T10:00:00.000Z",
              updatedAt: "2026-07-27T13:00:00.000Z",
            },
          ],
        }),
      }),
      watermark: makeWatermark({
        lastDigestSentAt: "2026-07-26T12:00:00.000Z",
      }),
    });

    expect(stale.kind).toBe("nothing_to_report");

    const newDegradation = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        integrationHealth: ok({
          rows: [
            {
              id: "gmail",
              serviceName: "gmail",
              status: "needs_attention",
              degradedSinceAt: "2026-07-26T13:30:00.000Z",
              updatedAt: "2026-07-27T13:00:00.000Z",
            },
          ],
        }),
      }),
      watermark: makeWatermark({
        lastDigestSentAt: "2026-07-26T13:00:00.000Z",
      }),
    });

    expect(newDegradation.kind).toBe("digest");
  });

  it("reports review-queue growth only above the baseline and suppresses already-seen cases", () => {
    const below = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        reviewQueues: ok({
          identityCases: Array.from({ length: 5 }, (_, index) => ({
            id: `identity:${String(index + 1)}`,
            openedAt: `2026-07-26T1${String(index)}:00:00.000Z`,
          })),
          routingCases: Array.from({ length: 5 }, (_, index) => ({
            id: `routing:${String(index + 1)}`,
            openedAt: `2026-07-26T2${String(index)}:00:00.000Z`,
          })),
        }),
      }),
      watermark: makeWatermark(),
    });

    expect(below.kind).toBe("nothing_to_report");

    const above = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        reviewQueues: ok({
          identityCases: Array.from({ length: 8 }, (_, index) => ({
            id: `identity:${String(index + 1)}`,
            openedAt: `2026-07-26T0${String(index)}:00:00.000Z`,
          })),
          routingCases: Array.from({ length: 4 }, (_, index) => ({
            id: `routing:${String(index + 1)}`,
            openedAt: `2026-07-26T1${String(index)}:00:00.000Z`,
          })),
        }),
      }),
      watermark: makeWatermark({
        identityResolutionQueue: {
          id: "identity:2",
          timestamp: "2026-07-26T01:00:00.000Z",
        },
      }),
    });

    expect(above.kind).toBe("nothing_to_report");

    const genuinelyNew = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        reviewQueues: ok({
          identityCases: Array.from({ length: 11 }, (_, index) => ({
            id: `identity:${String(index + 1)}`,
            openedAt: `2026-07-26T0${String(index % 10)}:00:00.000Z`,
          })),
          routingCases: [
            {
              id: "routing:1",
              openedAt: "2026-07-26T20:00:00.000Z",
            },
          ],
        }),
      }),
      watermark: makeWatermark(),
    });

    expect(genuinelyNew.kind).toBe("digest");
  });

  it("fires the weekly all-quiet note at 7 quiet days, not 6, and prefers a real report over the quiet note", () => {
    const sixDays = buildDailyOpsDigest({
      snapshot: makeSnapshot(),
      watermark: makeWatermark({
        quietStreakStartedAt: "2026-07-21T13:00:00.000Z",
      }),
    });

    expect(sixDays.kind).toBe("nothing_to_report");

    const sevenDays = buildDailyOpsDigest({
      snapshot: makeSnapshot(),
      watermark: makeWatermark({
        quietStreakStartedAt: "2026-07-20T13:00:00.000Z",
      }),
    });

    expect(sevenDays.kind).toBe("digest");
    if (sevenDays.kind !== "digest") {
      throw new Error("Expected a digest.");
    }

    expect(sevenDays.digest.kind).toBe("all_quiet");

    const realReportWins = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        pendingComposerOutbounds: ok({
          failedCount: 1,
          orphanedCount: 0,
        }),
      }),
      watermark: makeWatermark({
        quietStreakStartedAt: "2026-07-20T13:00:00.000Z",
      }),
    });

    expect(realReportWins.kind).toBe("digest");
    if (realReportWins.kind !== "digest") {
      throw new Error("Expected a digest.");
    }

    expect(realReportWins.digest.kind).toBe("issues");
  });

  it("surfaces an ungathered signal as a gap instead of treating it as zero", () => {
    const result = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        smsMessages: gap("sms query timed out"),
      }),
      watermark: makeWatermark(),
    });

    expect(result.kind).toBe("digest");
    if (result.kind !== "digest") {
      throw new Error("Expected a digest.");
    }

    expect(result.digest.sections[0]).toMatchObject({
      kind: "sms_messages",
      tone: "gap",
      details: [{ label: "Gap", value: "sms query timed out" }],
    });
  });

  it("composes multiple simultaneous signals in a stable order", () => {
    const result = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        syncState: ok({
          signals: [
            {
              provider: "gmail",
              label: "gmail live ingest",
              pollIntervalSeconds: 60,
              status: "failed",
              consecutiveFailureCount: 3,
              lastSuccessfulAt: "2026-07-27T12:56:00.000Z",
              deadLetterCount: 0,
            },
          ],
          missingProviders: [],
        }),
        sourceEvidenceQuarantine: ok({
          dayCount: 45,
        }),
        postmarkWebhookDeadLetter: ok({
          rows: [
            {
              id: "0001",
              receivedAt: "2026-07-26T08:00:00.000Z",
              status: "pending",
            },
          ],
        }),
        pendingComposerOutbounds: ok({
          failedCount: 1,
          orphanedCount: 0,
        }),
        smsMessages: gap("sms query timed out"),
        integrationHealth: ok({
          rows: [
            {
              id: "gmail",
              serviceName: "gmail",
              status: "needs_attention",
              degradedSinceAt: "2026-07-27T12:30:00.000Z",
              updatedAt: "2026-07-27T13:00:00.000Z",
            },
          ],
        }),
        reviewQueues: ok({
          identityCases: Array.from({ length: 11 }, (_, index) => ({
            id: `identity:${String(index + 1)}`,
            openedAt: `2026-07-26T0${String(index % 10)}:00:00.000Z`,
          })),
          routingCases: [],
        }),
      }),
      watermark: makeWatermark({
        lastDigestSentAt: "2026-07-27T12:00:00.000Z",
      }),
    });

    expect(result.kind).toBe("digest");
    if (result.kind !== "digest") {
      throw new Error("Expected a digest.");
    }

    expect(result.digest.sections.map((section) => section.kind)).toEqual([
      "sync_state",
      "source_evidence_quarantine",
      "postmark_webhook_dead_letter",
      "pending_composer_outbounds",
      "sms_messages",
      "integration_health",
      "review_queues",
    ]);
  });

  it("uses a dedup key that varies across consecutive Denver calendar days", () => {
    const first = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        pendingComposerOutbounds: ok({
          failedCount: 1,
          orphanedCount: 0,
        }),
      }),
      watermark: makeWatermark(),
    });
    const second = buildDailyOpsDigest({
      snapshot: makeSnapshot({
        digestDateDenver: "2026-07-28",
        pendingComposerOutbounds: ok({
          failedCount: 1,
          orphanedCount: 0,
        }),
      }),
      watermark: makeWatermark(),
    });

    expect(first.kind).toBe("digest");
    expect(second.kind).toBe("digest");
    if (first.kind !== "digest" || second.kind !== "digest") {
      throw new Error("Expected digests.");
    }

    expect(first.digest.dedupKey).not.toBe(second.digest.dedupKey);
  });
});
