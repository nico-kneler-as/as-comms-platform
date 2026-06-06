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

function normalizeSqlResultRows<TRow>(
  result:
    | readonly TRow[]
    | {
        readonly rows?: readonly TRow[];
      },
): readonly TRow[] {
  if (Array.isArray(result)) {
    return result as readonly TRow[];
  }

  return (result as { readonly rows?: readonly TRow[] }).rows ?? [];
}

function requireIsoTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

export interface RunMetricTileData {
  readonly key:
    | "queued"
    | "sent"
    | "replied"
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

export interface RunDetailHeaderModel {
  readonly runId: string;
  readonly state: CampaignRunRecord["state"];
  readonly subject: string;
  readonly preheader: string | null;
  readonly senderAlias: string | null;
  readonly kindLabel: "Project" | "Newsletter";
  readonly dateLabel: string;
  readonly dateIso: string;
  readonly canStopUnsent: boolean;
  readonly canDuplicate: boolean;
  readonly totalAudience: number | null;
  readonly projectLabel?: string | null;
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
  readonly projectLabelsById?: Readonly<Record<string, string>>;
  readonly canStopUnsent: boolean;
  readonly canDuplicate: boolean;
  readonly isAdmin: boolean;
}

interface ReplyRowDb {
  readonly contactId: string;
  readonly contactName: string | null;
  readonly email: string | null;
  readonly occurredAt: Date | string;
}

interface MailchimpCampaignAggregates {
  readonly sent: number;
  readonly opened: number;
  readonly clicked: number;
  readonly bounced: number;
  readonly unsubscribed: number;
  readonly distinctMembers: number;
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
  repliesCount: number,
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
      key: "replied",
      label: "Replied",
      value: repliesCount,
      percentage: formatPercentage(repliesCount, total),
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

function buildMailchimpMetricTiles(
  aggregates: MailchimpCampaignAggregates,
): readonly RunMetricTileData[] {
  const sent = aggregates.sent;
  const denominator = sent <= 0 ? 0 : sent;
  const delivered = Math.max(0, sent - aggregates.bounced);
  const replies = (aggregates as { readonly replies?: number }).replies ?? 0;

  return [
    {
      key: "queued",
      label: "Queued",
      value: aggregates.distinctMembers,
      percentage: formatPercentage(aggregates.distinctMembers, denominator),
      subtitle: null,
    },
    {
      key: "delivered",
      label: "Delivered",
      value: delivered,
      percentage: formatPercentage(delivered, denominator),
      subtitle: null,
    },
    {
      key: "opened",
      label: "Opened",
      value: aggregates.opened,
      percentage: formatPercentage(aggregates.opened, denominator),
      subtitle: null,
    },
    {
      key: "clicked",
      label: "Clicked",
      value: aggregates.clicked,
      percentage: formatPercentage(aggregates.clicked, denominator),
      subtitle: null,
    },
    {
      key: "replied",
      label: "Replied",
      value: replies,
      percentage: formatPercentage(replies, denominator),
      subtitle: null,
    },
    {
      key: "bounced",
      label: "Bounced",
      value: aggregates.bounced,
      percentage: formatPercentage(aggregates.bounced, denominator),
      subtitle: null,
    },
    {
      key: "unsubscribed",
      label: "Unsubscribed",
      value: aggregates.unsubscribed,
      percentage: formatPercentage(aggregates.unsubscribed, denominator),
      subtitle: null,
    },
    {
      key: "complained",
      label: "Complained",
      value: 0,
      percentage: formatPercentage(0, denominator),
      subtitle: "Not tracked for Mailchimp imports",
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

function getMailchimpRepository(
  runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>,
) {
  return runtime.repositories.mailchimpCampaignActivityDetails;
}

async function listProjects(
  runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>,
) {
  return runtime.settings.projects.listAll();
}

function buildProjectLabelsById(
  projects: Awaited<ReturnType<typeof listProjects>>,
): Readonly<Record<string, string>> {
  const entries: (readonly [string, string])[] = [];

  for (const project of projects) {
    const label = project.projectAlias ?? project.projectName;
    entries.push([project.projectId, label] as const);
  }

  return Object.fromEntries(entries);
}

function resolvePrimaryProjectLabel(input: {
  readonly projects: Awaited<ReturnType<typeof listProjects>>;
  readonly run: CampaignRunRecord;
}): string | null {
  const primaryProjectId = input.run.audienceCriteria.projectIds[0] ?? null;
  const projectMeta = primaryProjectId
    ? input.projects.find((project) => project.projectId === primaryProjectId) ??
      null
    : null;

  return projectMeta?.projectAlias ?? projectMeta?.projectName ?? null;
}

function buildHeaderModel(input: {
  readonly provider: "postmark" | "mailchimp";
  readonly run: CampaignRunRecord;
  readonly senderAlias: string | null;
  readonly isAdmin: boolean;
  readonly totalAudience: number | null;
  readonly projectLabel: string | null;
}): RunDetailHeaderModel {
  const { label: dateLabel, iso: dateIso } = resolveRunDate(input.run);
  const subject = input.run.subjectTemplate?.trim() ?? "";

  return {
    runId: input.run.id,
    state: input.run.state,
    subject: subject.length > 0 ? subject : "Untitled broadcast",
    preheader: (() => {
      const trimmed = input.run.preheader?.trim() ?? "";
      return trimmed.length > 0 ? trimmed : null;
    })(),
    senderAlias: input.senderAlias,
    kindLabel: input.run.kind === "project" ? "Project" : "Newsletter",
    dateLabel,
    dateIso,
    canStopUnsent:
      input.provider === "postmark" &&
      input.isAdmin &&
      (input.run.state === "sending" || input.run.state === "scheduled"),
    canDuplicate:
      input.provider === "postmark" &&
      (input.run.state === "complete" ||
        input.run.state === "finalized" ||
        input.run.state === "cancelled"),
    totalAudience: input.totalAudience,
    projectLabel: input.projectLabel,
  };
}

export async function getRunDetailHeaderModel(input: {
  readonly runId: string;
  readonly provider?: "postmark" | "mailchimp";
  readonly isAdmin: boolean;
}): Promise<RunDetailHeaderModel | null> {
  const runtime = await getStage1WebRuntime();
  const provider = input.provider ?? "postmark";
  const projectionReader = createCampaignRunProjectionReader({
    repositories: runtime.campaigns,
  });
  const projection = await projectionReader.getDetail(input.runId, provider);
  const run =
    projection === null
      ? provider === "postmark"
        ? await runtime.campaigns.campaignRuns.findById(input.runId)
        : null
      : buildProjectionRun(projection);

  if (run === null) {
    return null;
  }

  const totalAudience =
    provider === "mailchimp"
      ? run.audienceSize
      : (projection?.audienceSize ?? run.audienceSize);
  const allProjects = await listProjects(runtime);

  return buildHeaderModel({
    provider,
    run,
    senderAlias: run.fromEmail ?? (provider === "mailchimp" ? "Mailchimp" : null),
    isAdmin: input.isAdmin,
    totalAudience,
    projectLabel: resolvePrimaryProjectLabel({ projects: allProjects, run }),
  });
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

  const [mailchimpAggregates, metricCounts, recipientQuery] =
    provider === "mailchimp"
      ? await Promise.all([
          getMailchimpRepository(runtime).aggregateForCampaign(run.id),
          Promise.resolve<RunMetricCounts | null>(null),
          listRunRecipients({ runId: run.id, provider, limit: 100 }),
        ])
      : await Promise.all([
          Promise.resolve<MailchimpCampaignAggregates | null>(null),
          readRunMetricCounts({ runId: run.id }),
          listRunRecipients({ runId: run.id, provider, limit: 100 }),
        ]);
  const totalAudience =
    provider === "mailchimp"
      ? mailchimpAggregates?.distinctMembers ?? 0
      : run.audienceSize ?? metricCounts?.total ?? 0;
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
    const recentReplyRows = normalizeSqlResultRows<ReplyRowDb>(
      replyRowsResult as { readonly rows?: readonly ReplyRowDb[] },
    );
    const [countRow] = normalizeSqlResultRows<{ readonly count: number }>(
      countResult as {
        readonly rows?: readonly { readonly count: number }[];
      },
    );

    repliesCount = countRow?.count ?? 0;
    recentReplies = recentReplyRows.map((row) => ({
      contactId: row.contactId,
      contactName: row.contactName ?? row.email ?? row.contactId,
      email: row.email,
      occurredAt: requireIsoTimestamp(row.occurredAt),
    }));
  }
  const metrics =
    provider === "mailchimp" && mailchimpAggregates !== null
      ? buildMailchimpMetricTiles(mailchimpAggregates)
      : buildMetricTiles(
          metricCounts ?? {
            queued: 0,
            sent: 0,
            delivered: 0,
            opened: 0,
            clicked: 0,
            bounced: 0,
            unsubscribed: 0,
            complained: 0,
            total: 0,
          },
          totalAudience,
          repliesCount,
        );
  const sentCount =
    provider === "mailchimp"
      ? mailchimpAggregates?.sent ?? 0
      : metricCounts?.sent ?? 0;
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

  const audits =
    provider === "mailchimp"
      ? []
      : await runtime.repositories.auditEvidence.listByEntity({
          entityType: "campaign_run",
          entityId: run.id,
        });
  const allProjects = await listProjects(runtime);
  const { label: dateLabel, iso: dateIso } = resolveRunDate(run);

  return {
    provider,
    run,
    totalAudience,
    senderAlias:
      run.fromEmail ?? (provider === "mailchimp" ? "Mailchimp" : null),
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
    projectLabelsById: buildProjectLabelsById(allProjects),
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
