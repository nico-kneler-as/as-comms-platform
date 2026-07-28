import type {
  DependencyAuditAdvisory,
  IntegrationHealthStatus,
  SyncStatus,
} from "@as-comms/contracts";

export const dailyOpsDigestJobName = "daily-ops-digest" as const;
export const dailyOpsDigestCategory = "daily_ops_digest" as const;
export const dailyOpsDigestTimeZone = "America/Denver" as const;

export const sourceEvidenceQuarantineThreshold = 20;
export const reviewQueueDailyBaselineMax = 10;
export const weeklyQuietDays = 7;
export const syncStateFailureConsecutiveThreshold = 3;
export const syncStateFailurePollIntervalMultiplier = 3;
export const dependencyAuditStaleWindowMs = 36 * 60 * 60 * 1000;

export interface DailyOpsDigestWindow {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly labelDateDenver: string;
  readonly timeZone: typeof dailyOpsDigestTimeZone;
}

export type DailyOpsDigestSignal<T> =
  | {
      readonly kind: "ok";
      readonly value: T;
    }
  | {
      readonly kind: "gap";
      readonly detail: string;
    };

export interface DailyOpsDigestSyncStateSignal {
  readonly provider: string;
  readonly label: string;
  readonly pollIntervalSeconds: number;
  readonly status: SyncStatus;
  readonly consecutiveFailureCount: number;
  readonly lastSuccessfulAt: string | null;
  readonly deadLetterCount: number;
}

export interface DailyOpsDigestPostmarkDeadLetterRow {
  readonly id: string;
  readonly receivedAt: string;
  readonly status: "pending" | "retried" | "terminal";
}

export interface DailyOpsDigestReviewQueueCase {
  readonly id: string;
  readonly openedAt: string;
}

export interface DailyOpsDigestIntegrationHealthSignal {
  readonly id: string;
  readonly serviceName: string;
  readonly status: IntegrationHealthStatus;
  readonly degradedSinceAt: string | null;
  readonly updatedAt: string;
}

export interface DailyOpsDigestDependencyAuditSummary {
  readonly generatedAt: string;
  readonly exitStatus: number;
  readonly advisories: readonly DependencyAuditAdvisory[];
}

export interface DailyOpsDigestSnapshot {
  readonly runAt: string;
  readonly digestDateDenver: string;
  readonly window: DailyOpsDigestWindow;
  readonly syncState: DailyOpsDigestSignal<{
    readonly signals: readonly DailyOpsDigestSyncStateSignal[];
    readonly missingProviders: readonly string[];
  }>;
  readonly sourceEvidenceQuarantine: DailyOpsDigestSignal<{
    readonly dayCount: number;
  }>;
  readonly postmarkWebhookDeadLetter: DailyOpsDigestSignal<{
    readonly rows: readonly DailyOpsDigestPostmarkDeadLetterRow[];
  }>;
  readonly pendingComposerOutbounds: DailyOpsDigestSignal<{
    readonly failedCount: number;
    readonly orphanedCount: number;
  }>;
  readonly smsMessages: DailyOpsDigestSignal<{
    readonly failedCount: number;
    readonly undeliveredCount: number;
  }>;
  readonly integrationHealth: DailyOpsDigestSignal<{
    readonly rows: readonly DailyOpsDigestIntegrationHealthSignal[];
  }>;
  readonly reviewQueues: DailyOpsDigestSignal<{
    readonly identityCases: readonly DailyOpsDigestReviewQueueCase[];
    readonly routingCases: readonly DailyOpsDigestReviewQueueCase[];
  }>;
  readonly dependencyAudit: DailyOpsDigestSignal<DailyOpsDigestDependencyAuditSummary | null>;
}

export interface DailyOpsDigestHighWaterMark {
  readonly id: string;
  readonly timestamp: string;
}

export interface DailyOpsDigestWatermarkState {
  readonly lastRunAt: string | null;
  readonly lastDigestSentAt: string | null;
  readonly quietStreakStartedAt: string | null;
  readonly syncStateDeadLetterCounts: Readonly<Record<string, number>>;
  readonly reportedDependencyAdvisoryIds: readonly string[];
  readonly postmarkWebhookDeadLetter: DailyOpsDigestHighWaterMark | null;
  readonly identityResolutionQueue: DailyOpsDigestHighWaterMark | null;
  readonly routingReviewQueue: DailyOpsDigestHighWaterMark | null;
}

export interface DailyOpsDigestObservedState {
  readonly syncStateDeadLetterCounts?: Readonly<Record<string, number>>;
  readonly reportedDependencyAdvisoryIds?: readonly string[];
  readonly postmarkWebhookDeadLetter?: DailyOpsDigestHighWaterMark | null;
  readonly identityResolutionQueue?: DailyOpsDigestHighWaterMark | null;
  readonly routingReviewQueue?: DailyOpsDigestHighWaterMark | null;
}

export type DailyOpsDigestSectionKind =
  | "sync_state"
  | "source_evidence_quarantine"
  | "postmark_webhook_dead_letter"
  | "pending_composer_outbounds"
  | "sms_messages"
  | "integration_health"
  | "review_queues"
  | "dependency_audit";

export interface DailyOpsDigestSection {
  readonly kind: DailyOpsDigestSectionKind;
  readonly tone: "alert" | "gap";
  readonly title: string;
  readonly summary: string;
  readonly baseline: string | null;
  readonly details: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly linkTarget: "logs" | "integrations";
}

export interface DailyOpsDigest {
  readonly kind: "issues" | "all_quiet";
  readonly dedupKey: string;
  readonly digestDateDenver: string;
  readonly runAt: string;
  readonly window: DailyOpsDigestWindow;
  readonly summary: string;
  readonly sections: readonly DailyOpsDigestSection[];
}

export type DailyOpsDigestBuildResult =
  | {
      readonly kind: "digest";
      readonly digest: DailyOpsDigest;
      readonly observedState: DailyOpsDigestObservedState;
    }
  | {
      readonly kind: "nothing_to_report";
      readonly observedState: DailyOpsDigestObservedState;
    };
