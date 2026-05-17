import { sql } from "drizzle-orm";

import type {
  AudienceCriteria,
  AuditEvidenceRecord,
  CampaignRunRecord,
  CampaignRunProjectionRow,
  RunState,
} from "@as-comms/contracts";
import { audienceCriteriaSchema } from "@as-comms/contracts";
import { createCampaignRunProjectionReader } from "@as-comms/domain";

import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import {
  listRunRecipients,
  readRunMetricCounts,
  type RecipientRowData,
  type RunMetricCounts,
} from "../../_lib/run-recipients";

export interface RunMetricTileData {
  readonly key:
    | "queued"
    | "sent"
    | "delivered"
    | "opened"
    | "clicked"
    | "bounced"
    | "unsubscribed"
    | "complained";
  readonly label: string;
  readonly value: number;
  readonly percentage: number;
  readonly subtitle: string | null;
}

export interface ReplyPreviewRow {
  readonly contactId: string;
  readonly contactName: string;
  readonly email: string | null;
  readonly occurredAt: string;
}

export interface RunAuditEntry {
  readonly id: string;
  readonly action: string;
  readonly occurredAt: string;
  readonly actorLabel: string;
  readonly detail: string | null;
}

export interface RunDetailModel {
  readonly provider: "postmark" | "mailchimp";
  readonly run: CampaignRunRecord;
  readonly totalAudience: number;
  readonly senderAlias: string | null;
  readonly kindLabel: "Project" | "Newsletter";
  readonly dateLabel: string;
  readonly dateIso: string;
  readonly metrics: readonly RunMetricTileData[];
  readonly sentCount: number;
  readonly queuedCount: number;
  readonly progressPercent: number;
  readonly estimatedMinutesRemaining: number | null;
  readonly recipients: readonly RecipientRowData[];
  readonly recipientTotal: number;
  readonly repliesCount: number;
  readonly recentReplies: readonly ReplyPreviewRow[];
  readonly inboxRecipientsHref: string;
  readonly auditEntries: readonly RunAuditEntry[];
  readonly audienceCriteria: AudienceCriteria;
  readonly canStopUnsent: boolean;
  readonly canDuplicate: boolean;
  readonly isAdmin: boolean;
}

interface ReplyRowDb {
  readonly contactId: string;
  readonly contactName: string | null;
  readonly email: string | null;
  readonly occurredAt: Date;
}

function formatPercentage(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Math.round((value / total) * 1000) / 10;
}

function resolveRunDate(run: CampaignRunRecord): {
  readonly label: string;
  readonly iso: string;
} {
  if (run.state === "finalized" && run.finalizedAt !== null) {
    return { label: "Finalized", iso: run.finalizedAt };
  }
  if (run.state === "cancelled" && run.cancelledAt !== null) {
    return { label: "Cancelled", iso: run.cancelledAt };
  }
  if (run.state === "complete" && run.completedAt !== null) {
    return { label: "Completed", iso: run.completedAt };
  }
  if (run.state === "sending") {
    return {
      label: "Started",
      iso: run.startedAt ?? run.scheduledAt ?? run.createdAt,
    };
  }
  if (run.state === "scheduled") {
    return {
      label: run.startedAt === null ? "Scheduled" : "Started",
      iso: run.startedAt ?? run.scheduledAt ?? run.createdAt,
    };
  }

  return { label: "Created", iso: run.createdAt };
}

function buildMetricTiles(
  counts: RunMetricCounts,
  total: number,
): readonly RunMetricTileData[] {
  return [
    {
      key: "queued",
      label: "Queued",
      value: counts.queued,
      percentage: formatPercentage(counts.queued, total),
      subtitle: null,
    },
    {
      key: "sent",
      label: "Sent",
      value: counts.sent,
      percentage: formatPercentage(counts.sent, total),
      subtitle: null,
    },
    {
      key: "delivered",
      label: "Delivered",
      value: counts.delivered,
      percentage: formatPercentage(counts.delivered, total),
      subtitle: "Postmark confirms",
    },
    {
      key: "opened",
      label: "Opened",
      value: counts.opened,
      percentage: formatPercentage(counts.opened, total),
      subtitle: null,
    },
    {
      key: "clicked",
      label: "Clicked",
      value: counts.clicked,
      percentage: formatPercentage(counts.clicked, total),
      subtitle: null,
    },
    {
      key: "bounced",
      label: "Bounced",
      value: counts.bounced,
      percentage: formatPercentage(counts.bounced, total),
      subtitle: null,
    },
    {
      key: "unsubscribed",
      label: "Unsubscribed",
      value: counts.unsubscribed,
      percentage: formatPercentage(counts.unsubscribed, total),
      subtitle: null,
    },
    {
      key: "complained",
      label: "Complained",
      value: counts.complained,
      percentage: formatPercentage(counts.complained, total),
      subtitle: null,
    },
  ];
}

function buildHistoricalMetricTiles(
  total: number,
  state: CampaignRunRecord["state"],
): readonly RunMetricTileData[] {
  const sent = state === "complete" || state === "finalized" ? total : 0;
  const queued = Math.max(0, total - sent);

  return [
    {
      key: "queued",
      label: "Queued",
      value: queued,
      percentage: formatPercentage(queued, total),
      subtitle: null,
    },
    {
      key: "sent",
      label: "Sent",
      value: sent,
      percentage: formatPercentage(sent, total),
      subtitle: total === 0 ? "Historical Mailchimp import" : null,
    },
    {
      key: "delivered",
      label: "Delivered",
      value: 0,
      percentage: 0,
      subtitle: "Not imported from Mailchimp",
    },
    {
      key: "opened",
      label: "Opened",
      value: 0,
      percentage: 0,
      subtitle: "Not imported from Mailchimp",
    },
    {
      key: "clicked",
      label: "Clicked",
      value: 0,
      percentage: 0,
      subtitle: "Not imported from Mailchimp",
    },
    {
      key: "bounced",
      label: "Bounced",
      value: 0,
      percentage: 0,
      subtitle: "Not imported from Mailchimp",
    },
    {
      key: "unsubscribed",
      label: "Unsubscribed",
      value: 0,
      percentage: 0,
      subtitle: "Not imported from Mailchimp",
    },
    {
      key: "complained",
      label: "Complained",
      value: 0,
      percentage: 0,
      subtitle: "Not imported from Mailchimp",
    },
  ];
}

function buildProjectionRun(
  projection: CampaignRunProjectionRow,
): CampaignRunRecord {
  return {
    id: projection.runId,
    kind: projection.kind,
    launchType: projection.launchType,
    state: projection.state,
    projectId: projection.projectId,
    name: projection.subject.trim().length === 0 ? null : projection.subject,
    fromEmail: null,
    fromName: null,
    replyToEmail: null,
    subjectTemplate: projection.subject,
    bodyHtmlTemplate: null,
    bodyTextTemplate: null,
    preheader: null,
    audienceCriteria: audienceCriteriaSchema.parse({}),
    audienceSize: projection.audienceSize,
    scheduledAt: projection.scheduledAt,
    startedAt: projection.startedAt,
    completedAt: projection.completedAt,
    finalizedAt: null,
    cancelledAt: projection.cancelledAt,
    cancelledReason: null,
    createdByUserId: null,
    lastEditedByUserId: null,
    createdAt: projection.createdAt,
    updatedAt: projection.updatedAt,
  };
}

function estimateMinutesRemaining(input: {
  readonly runState: RunState;
  readonly startedAt: string | null;
  readonly sentCount: number;
  readonly totalAudience: number;
  readonly now: Date;
}): number | null {
  if (input.runState !== "sending" || input.startedAt === null) {
    return null;
  }
  if (input.sentCount <= 0 || input.totalAudience <= input.sentCount) {
    return null;
  }

  const elapsedMs = input.now.getTime() - new Date(input.startedAt).getTime();
  if (elapsedMs <= 0) {
    return null;
  }

  const ratePerMs = input.sentCount / elapsedMs;
  if (!Number.isFinite(ratePerMs) || ratePerMs <= 0) {
    return null;
  }

  const remainingCount = input.totalAudience - input.sentCount;
  return Math.max(1, Math.ceil(remainingCount / ratePerMs / 60_000));
}

function buildAuditEntry(record: AuditEvidenceRecord): RunAuditEntry {
  const detail =
    typeof record.metadataJson.detail === "string"
      ? record.metadataJson.detail
      : typeof record.metadataJson.reason === "string"
        ? record.metadataJson.reason
        : typeof record.metadataJson.summary === "string"
          ? record.metadataJson.summary
          : null;

  return {
    id: record.id,
    action: record.action,
    occurredAt: record.occurredAt,
    actorLabel: record.actorType === "user" ? "Operator" : "System",
    detail,
  };
}

export async function getRunDetailModel(input: {
  readonly runId: string;
  readonly provider?: "postmark" | "mailchimp";
  readonly isAdmin: boolean;
}): Promise<RunDetailModel | null> {
  const runtime = await getStage1WebRuntime();
  const provider = input.provider ?? "postmark";
  const projectionReader = createCampaignRunProjectionReader({
    repositories: runtime.campaigns,
  });
  const projection =
    provider === "mailchimp"
      ? await projectionReader.getDetail(input.runId, "mailchimp")
      : null;
  const run =
    projection === null
      ? await runtime.campaigns.campaignRuns.findById(input.runId)
      : buildProjectionRun(projection);
  if (run === null) {
    return null;
  }

  const [metricCounts, recipientQuery] =
    provider === "mailchimp"
      ? [
          null,
          {
            rows: [],
            total: 0,
          } satisfies Awaited<ReturnType<typeof listRunRecipients>>,
        ]
      : await Promise.all([
          readRunMetricCounts({ runId: run.id }),
          listRunRecipients({ runId: run.id, limit: 100 }),
        ]);
  const totalAudience =
    run.audienceSize ?? (metricCounts === null ? 0 : metricCounts.total);
  const metrics =
    metricCounts === null
      ? buildHistoricalMetricTiles(totalAudience, run.state)
      : buildMetricTiles(metricCounts, totalAudience);
  const sentCount = metrics.find((metric) => metric.key === "sent")?.value ?? 0;
  const queuedCount =
    metrics.find((metric) => metric.key === "queued")?.value ?? 0;
  const progressPercent =
    totalAudience === 0 ? 0 : Math.round((sentCount / totalAudience) * 100);
  const estimatedMinutesRemaining = estimateMinutesRemaining({
    runState: run.state,
    startedAt: run.startedAt,
    sentCount,
    totalAudience,
    now: new Date(),
  });
  const recipients = recipientQuery.rows;

  let repliesCount = 0;
  let recentReplies: readonly ReplyPreviewRow[] = [];
  if (
    runtime.connection !== null &&
    provider === "postmark" &&
    run.completedAt !== null
  ) {
    const threshold = run.completedAt;
    const replyRowsResult = await runtime.connection.db.execute(sql<ReplyRowDb>`
      select
        cel.contact_id as "contactId",
        c.display_name as "contactName",
        c.primary_email as "email",
        cel.occurred_at as "occurredAt"
      from canonical_event_ledger cel
      inner join contacts c
        on c.id = cel.contact_id
      where cel.event_type = 'communication.email.inbound'
        and cel.occurred_at > ${threshold}::timestamptz
        and exists (
          select 1
          from audience_snapshots snapshot
          where snapshot.campaign_run_id = ${run.id}
            and snapshot.contact_id = cel.contact_id
        )
      order by cel.occurred_at desc, cel.id desc
      limit 5
    `);
    const countResult = await runtime.connection.db.execute(
      sql<{ readonly count: number }>`
        select count(*)::int as "count"
        from canonical_event_ledger cel
        where cel.event_type = 'communication.email.inbound'
          and cel.occurred_at > ${threshold}::timestamptz
          and exists (
            select 1
            from audience_snapshots snapshot
            where snapshot.campaign_run_id = ${run.id}
              and snapshot.contact_id = cel.contact_id
          )
      `,
    );
    const recentReplyRows =
      (replyRowsResult as { readonly rows?: readonly ReplyRowDb[] }).rows ?? [];
    const [countRow] =
      (
        countResult as {
          readonly rows?: readonly { readonly count: number }[];
        }
      ).rows ?? [];

    repliesCount = countRow?.count ?? 0;
    recentReplies = recentReplyRows.map((row) => ({
      contactId: row.contactId,
      contactName: row.contactName ?? row.email ?? row.contactId,
      email: row.email,
      occurredAt: row.occurredAt.toISOString(),
    }));
  }

  const audits = await runtime.repositories.auditEvidence.listByEntity({
    entityType: "campaign_run",
    entityId: run.id,
  });
  const { label: dateLabel, iso: dateIso } = resolveRunDate(run);

  return {
    provider,
    run,
    totalAudience,
    senderAlias:
      run.fromEmail ?? (provider === "mailchimp" ? "Mailchimp import" : null),
    kindLabel: run.kind === "project" ? "Project" : "Newsletter",
    dateLabel,
    dateIso,
    metrics,
    sentCount,
    queuedCount,
    progressPercent,
    estimatedMinutesRemaining,
    recipients,
    recipientTotal: recipientQuery.total,
    repliesCount,
    recentReplies,
    inboxRecipientsHref: "/inbox",
    auditEntries: audits.map(buildAuditEntry),
    audienceCriteria: run.audienceCriteria,
    canStopUnsent:
      provider === "postmark" &&
      input.isAdmin &&
      (run.state === "sending" || run.state === "scheduled"),
    canDuplicate:
      provider === "postmark" &&
      (run.state === "complete" ||
        run.state === "finalized" ||
        run.state === "cancelled"),
    isAdmin: input.isAdmin,
  };
}
