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

import {
  aggregateBroadcastLinkClicksForRun,
  getStage1WebRuntime,
} from "@/src/server/stage1-runtime";

import {
  listRunRecipients,
  readRunEngagementBreakdown,
  readRunMetricCounts,
  readSmsRunMetricCounts,
  readRunVariantMetricCounts,
  type RecipientRowData,
  type RunEngagementBreakdown,
  type RunMetricCounts,
  type RunVariantMetricCounts,
} from "../../_lib/run-recipients";

type RunChannel = "email" | "sms";
type RunProvider = "postmark" | "mailchimp" | "sms";

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
    | "failed"
    | "suppressed"
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
  readonly provider: RunProvider;
  readonly channel: RunChannel;
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
  readonly botActivity: {
    readonly opens: {
      readonly human: number;
      readonly bot: number;
      readonly hasEventData: boolean;
    };
    readonly clicks: {
      readonly human: number;
      readonly bot: number;
      readonly hasEventData: boolean;
    };
  };
  readonly linkClicks: readonly {
    url: string;
    totalClicks: number;
    botClicks: number;
    uniqueClickers: number;
  }[];
  readonly subjectVariantBreakdown: readonly SubjectVariantBreakdown[] | null;
  readonly audienceCriteria: AudienceCriteria;
  readonly projectLabelsById?: Readonly<Record<string, string>>;
  readonly canStopUnsent: boolean;
  readonly canDuplicate: boolean;
  readonly isAdmin: boolean;
}

export interface SubjectVariantBreakdown {
  readonly variant: "a" | "b";
  readonly label: "A" | "B";
  readonly subject: string | null;
  readonly assigned: number;
  readonly delivered: number;
  readonly deliveredRate: number;
  readonly opened: number;
  readonly openedRate: number;
  readonly clicked: number;
  readonly clickedRate: number;
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

const EMPTY_RUN_ENGAGEMENT_BREAKDOWN: RunEngagementBreakdown = {
  opens: { human: 0, bot: 0, hasEventData: false },
  clicks: { human: 0, bot: 0, hasEventData: false },
};

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
      key: "sent",
      label: "Sent",
      value: counts.sent,
      percentage: formatPercentage(counts.sent, total),
      subtitle: "Accepted by Postmark",
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

function buildSmsMetricTiles(
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
      key: "sent",
      label: "Sent",
      value: counts.sent,
      percentage: formatPercentage(counts.sent, total),
      subtitle: "Accepted by Twilio",
    },
    {
      key: "delivered",
      label: "Delivered",
      value: counts.delivered,
      percentage: formatPercentage(counts.delivered, total),
      subtitle: null,
    },
    {
      key: "failed",
      label: "Failed",
      value: counts.failed,
      percentage: formatPercentage(counts.failed, total),
      subtitle: null,
    },
    {
      key: "suppressed",
      label: "Suppressed",
      value: counts.suppressed,
      percentage: formatPercentage(counts.suppressed, total),
      subtitle: null,
    },
    {
      key: "replied",
      label: "Replied",
      value: repliesCount,
      percentage: formatPercentage(repliesCount, total),
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
      key: "sent",
      label: "Sent",
      value: sent,
      percentage: formatPercentage(sent, denominator),
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
    subjectTemplateB: null,
    abTestEnabled: false,
    bodyHtmlTemplate: null,
    bodyDesignJson: null,
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

function buildSubjectVariantBreakdown(input: {
  readonly run: CampaignRunRecord;
  readonly counts: readonly RunVariantMetricCounts[];
}): readonly SubjectVariantBreakdown[] {
  const countsByVariant = new Map(
    input.counts.map((entry) => [entry.subjectVariant, entry] as const),
  );
  const subjectA = input.run.subjectTemplate?.trim() ?? "";
  const subjectB = input.run.subjectTemplateB?.trim() ?? "";

  return ([
    {
      variant: "a",
      label: "A",
      subject: subjectA.length > 0 ? subjectA : null,
    },
    {
      variant: "b",
      label: "B",
      subject: subjectB.length > 0 ? subjectB : null,
    },
  ] as const).map((variant) => {
    const counts = countsByVariant.get(variant.variant);
    const assigned = counts?.total ?? 0;
    const delivered = counts?.delivered ?? 0;
    const opened = counts?.opened ?? 0;
    const clicked = counts?.clicked ?? 0;

    return {
      variant: variant.variant,
      label: variant.label,
      subject: variant.subject,
      assigned,
      delivered,
      deliveredRate: formatPercentage(delivered, assigned),
      opened,
      openedRate: formatPercentage(opened, assigned),
      clicked,
      clickedRate: formatPercentage(clicked, assigned),
    };
  });
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
  const primaryProjectId =
    input.run.projectId ?? input.run.audienceCriteria.projectIds[0] ?? null;
  const projectMeta = primaryProjectId
    ? input.projects.find((project) => project.projectId === primaryProjectId) ??
      null
    : null;

  return projectMeta?.projectAlias ?? projectMeta?.projectName ?? null;
}

function buildHeaderModel(input: {
  readonly provider: RunProvider;
  readonly run: CampaignRunRecord;
  readonly senderAlias: string | null;
  readonly isAdmin: boolean;
  readonly totalAudience: number | null;
  readonly projectLabel: string | null;
}): RunDetailHeaderModel {
  const { label: dateLabel, iso: dateIso } = resolveRunDate(input.run);
  const subjectTemplate = input.run.subjectTemplate?.trim() ?? "";
  const runName = input.run.name?.trim() ?? "";

  return {
    runId: input.run.id,
    state: input.run.state,
    subject:
      subjectTemplate.length > 0
        ? subjectTemplate
        : runName.length > 0
          ? runName
          : "Untitled broadcast",
    preheader: (() => {
      const trimmed = input.run.preheader?.trim() ?? "";
      return trimmed.length > 0 ? trimmed : null;
    })(),
    senderAlias: input.senderAlias,
    kindLabel: input.run.kind === "project" ? "Project" : "Newsletter",
    dateLabel,
    dateIso,
    canStopUnsent:
      input.provider !== "mailchimp" &&
      input.isAdmin &&
      (input.run.state === "sending" || input.run.state === "scheduled"),
    canDuplicate:
      input.provider !== "mailchimp" &&
      (input.run.state === "complete" ||
        input.run.state === "finalized" ||
        input.run.state === "cancelled"),
    totalAudience: input.totalAudience,
    projectLabel: input.projectLabel,
  };
}

export async function getRunDetailHeaderModel(input: {
  readonly runId: string;
  readonly provider?: "postmark" | "mailchimp" | "sms";
  readonly isAdmin: boolean;
}): Promise<RunDetailHeaderModel | null> {
  const runtime = await getStage1WebRuntime();
  const requestedProvider =
    input.provider === "mailchimp" ? "mailchimp" : "postmark";
  const projectionReader = createCampaignRunProjectionReader({
    repositories: runtime.campaigns,
  });
  const projection =
    requestedProvider === "mailchimp"
      ? await projectionReader.getDetail(input.runId, "mailchimp")
      : null;
  const run =
    projection === null
      ? await runtime.campaigns.campaignRuns.findById(input.runId)
      : buildProjectionRun(projection);

  if (run === null) {
    return null;
  }

  const provider: RunProvider =
    run.launchType === "sms" ? "sms" : requestedProvider;

  const totalAudience =
    provider === "mailchimp"
      ? run.audienceSize
      : (projection?.audienceSize ?? run.audienceSize);
  const allProjects = await listProjects(runtime);

  return buildHeaderModel({
    provider,
    run,
    senderAlias:
      provider === "mailchimp" ? "Mailchimp" : (run.fromEmail ?? null),
    isAdmin: input.isAdmin,
    totalAudience,
    projectLabel: resolvePrimaryProjectLabel({ projects: allProjects, run }),
  });
}

export async function getRunDetailModel(input: {
  readonly runId: string;
  readonly provider?: "postmark" | "mailchimp" | "sms";
  readonly isAdmin: boolean;
}): Promise<RunDetailModel | null> {
  const runtime = await getStage1WebRuntime();
  const requestedProvider =
    input.provider === "mailchimp" ? "mailchimp" : "postmark";
  const projectionReader = createCampaignRunProjectionReader({
    repositories: runtime.campaigns,
  });
  const projection =
    requestedProvider === "mailchimp"
      ? await projectionReader.getDetail(input.runId, "mailchimp")
      : null;
  const run =
    projection === null
      ? await runtime.campaigns.campaignRuns.findById(input.runId)
      : buildProjectionRun(projection);
  if (run === null) {
    return null;
  }

  const provider: RunProvider =
    run.launchType === "sms" ? "sms" : requestedProvider;
  const channel: RunChannel = provider === "sms" ? "sms" : "email";

  const [
    mailchimpAggregates,
    metricCounts,
    variantMetricCounts,
    recipientQuery,
    engagementBreakdown,
    linkClicks,
  ] =
    provider === "mailchimp"
      ? await Promise.all([
          getMailchimpRepository(runtime).aggregateForCampaign(run.id),
          Promise.resolve<RunMetricCounts | null>(null),
          Promise.resolve<readonly RunVariantMetricCounts[]>([]),
          listRunRecipients({ runId: run.id, provider, limit: 100 }),
          Promise.resolve(EMPTY_RUN_ENGAGEMENT_BREAKDOWN),
          Promise.resolve<
            readonly {
              originalLink: string;
              totalClicks: number;
              botClicks: number;
              uniqueClickers: number;
            }[]
          >([]),
        ])
      : provider === "sms"
        ? await Promise.all([
            Promise.resolve<MailchimpCampaignAggregates | null>(null),
            readSmsRunMetricCounts({ runId: run.id }),
            Promise.resolve<readonly RunVariantMetricCounts[]>([]),
            listRunRecipients({ runId: run.id, provider: "sms", limit: 100 }),
            Promise.resolve(EMPTY_RUN_ENGAGEMENT_BREAKDOWN),
            Promise.resolve<
              readonly {
                originalLink: string;
                totalClicks: number;
                botClicks: number;
                uniqueClickers: number;
              }[]
            >([]),
          ])
      : await Promise.all([
          Promise.resolve<MailchimpCampaignAggregates | null>(null),
          readRunMetricCounts({ runId: run.id }),
          readRunVariantMetricCounts({ runId: run.id }),
          listRunRecipients({ runId: run.id, provider, limit: 100 }),
          readRunEngagementBreakdown(run.id),
          aggregateBroadcastLinkClicksForRun(run.id),
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
    run.completedAt !== null
  ) {
    const threshold = run.completedAt;
    if (provider === "postmark") {
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
    } else if (provider === "sms") {
      const replyRowsResult = await runtime.connection.db.execute(sql<ReplyRowDb>`
        select
          cel.contact_id as "contactId",
          c.display_name as "contactName",
          c.primary_phone as "email",
          cel.occurred_at as "occurredAt"
        from canonical_event_ledger cel
        inner join contacts c
          on c.id = cel.contact_id
        where cel.event_type = 'communication.sms.inbound'
          and cel.occurred_at > ${threshold}::timestamptz
          and exists (
            select 1
            from sms_messages sms
            where sms.broadcast_run_id = ${run.id}
              and sms.direction = 'outbound'
              and sms.contact_id = cel.contact_id
          )
        order by cel.occurred_at desc, cel.id desc
        limit 5
      `);
      const countResult = await runtime.connection.db.execute(
        sql<{ readonly count: number }>`
          select count(*)::int as "count"
          from canonical_event_ledger cel
          where cel.event_type = 'communication.sms.inbound'
            and cel.occurred_at > ${threshold}::timestamptz
            and exists (
              select 1
              from sms_messages sms
              where sms.broadcast_run_id = ${run.id}
                and sms.direction = 'outbound'
                and sms.contact_id = cel.contact_id
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
  }
  const postmarkMetricCounts = metricCounts ?? {
    queued: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    suppressed: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    unsubscribed: 0,
    complained: 0,
    total: 0,
  };
  const adjustedMetricCounts: RunMetricCounts = {
    ...postmarkMetricCounts,
    opened: engagementBreakdown.opens.hasEventData
      ? engagementBreakdown.opens.human
      : postmarkMetricCounts.opened,
    clicked: engagementBreakdown.clicks.hasEventData
      ? engagementBreakdown.clicks.human
      : postmarkMetricCounts.clicked,
  };
  const metrics =
    provider === "mailchimp" && mailchimpAggregates !== null
      ? buildMailchimpMetricTiles(mailchimpAggregates)
      : provider === "sms"
        ? buildSmsMetricTiles(
            metricCounts ?? {
              queued: 0,
              sent: 0,
              delivered: 0,
              failed: 0,
              suppressed: 0,
              opened: 0,
              clicked: 0,
              bounced: 0,
              unsubscribed: 0,
              complained: 0,
              total: 0,
            },
            totalAudience,
            repliesCount,
          )
        : buildMetricTiles(adjustedMetricCounts, totalAudience, repliesCount);
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
    channel,
    run,
    totalAudience,
    senderAlias:
      provider === "mailchimp" ? "Mailchimp" : (run.fromEmail ?? null),
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
    botActivity: engagementBreakdown,
    linkClicks: linkClicks.map((entry) => ({
      url: entry.originalLink,
      totalClicks: entry.totalClicks,
      botClicks: entry.botClicks,
      uniqueClickers: entry.uniqueClickers,
    })),
    subjectVariantBreakdown:
      provider === "postmark" && run.abTestEnabled
        ? buildSubjectVariantBreakdown({
            run,
            counts: variantMetricCounts,
          })
        : null,
    audienceCriteria: run.audienceCriteria,
    projectLabelsById: buildProjectLabelsById(allProjects),
    canStopUnsent:
      provider !== "mailchimp" &&
      input.isAdmin &&
      (run.state === "sending" || run.state === "scheduled"),
    canDuplicate:
      provider !== "mailchimp" &&
      (run.state === "complete" ||
        run.state === "finalized" ||
        run.state === "cancelled"),
    isAdmin: input.isAdmin,
  };
}
