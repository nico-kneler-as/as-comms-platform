import { sql } from "drizzle-orm";

import type {
  AudienceCriteria,
  AudienceSnapshotRecord,
  AuditEvidenceRecord,
  CampaignRunRecord,
  CampaignRunProjectionRow,
  RunState,
} from "@as-comms/contracts";
import { audienceCriteriaSchema } from "@as-comms/contracts";
import { createCampaignRunProjectionReader } from "@as-comms/domain";

import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

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

export type RecipientLatestState =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "unsubscribed"
  | "complained"
  | "failed"
  | "suppressed";

export interface RecipientRowData {
  readonly snapshotId: string;
  readonly contactId: string;
  readonly name: string;
  readonly email: string;
  readonly project: string | null;
  readonly latestState: RecipientLatestState;
  readonly latestStateLabel: string;
  readonly lastEventAt: string | null;
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

function countWhere(
  snapshots: readonly AudienceSnapshotRecord[],
  predicate: (snapshot: AudienceSnapshotRecord) => boolean,
): number {
  return snapshots.reduce(
    (count, snapshot) => count + (predicate(snapshot) ? 1 : 0),
    0,
  );
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

function resolveRecipientLatestState(
  snapshot: AudienceSnapshotRecord,
): RecipientLatestState {
  if (snapshot.clickedAt !== null) {
    return "clicked";
  }
  if (snapshot.openedAt !== null) {
    return "opened";
  }
  if (snapshot.unsubscribedAt !== null) {
    return "unsubscribed";
  }
  if (snapshot.deliveryStatus === "complained") {
    return "complained";
  }
  if (snapshot.deliveryStatus === "bounced") {
    return "bounced";
  }
  if (snapshot.deliveryStatus === "delivered") {
    return "delivered";
  }
  if (snapshot.deliveryStatus === "sent") {
    return "sent";
  }
  if (snapshot.deliveryStatus === "failed") {
    return "failed";
  }
  if (snapshot.deliveryStatus === "suppressed_at_send") {
    return "suppressed";
  }
  return "queued";
}

function recipientStateLabel(state: RecipientLatestState): string {
  switch (state) {
    case "queued":
      return "Queued";
    case "sent":
      return "Sent";
    case "delivered":
      return "Delivered";
    case "opened":
      return "Opened";
    case "clicked":
      return "Clicked";
    case "bounced":
      return "Bounced";
    case "unsubscribed":
      return "Unsubscribed";
    case "complained":
      return "Complained";
    case "failed":
      return "Failed";
    case "suppressed":
      return "Suppressed";
  }
}

function buildMetricTiles(
  snapshots: readonly AudienceSnapshotRecord[],
  total: number,
): readonly RunMetricTileData[] {
  const queued = countWhere(
    snapshots,
    (snapshot) => snapshot.deliveryStatus === "pending",
  );
  const sent = countWhere(
    snapshots,
    (snapshot) =>
      snapshot.sentAt !== null ||
      snapshot.deliveryStatus === "delivered" ||
      snapshot.deliveryStatus === "bounced" ||
      snapshot.deliveryStatus === "complained" ||
      snapshot.deliveryStatus === "unsubscribed",
  );
  const delivered = countWhere(
    snapshots,
    (snapshot) =>
      snapshot.deliveryStatus === "delivered" ||
      snapshot.openedAt !== null ||
      snapshot.clickedAt !== null,
  );
  const opened = countWhere(
    snapshots,
    (snapshot) => snapshot.openedAt !== null,
  );
  const clicked = countWhere(
    snapshots,
    (snapshot) => snapshot.clickedAt !== null,
  );
  const bounced = countWhere(
    snapshots,
    (snapshot) => snapshot.deliveryStatus === "bounced",
  );
  const unsubscribed = countWhere(
    snapshots,
    (snapshot) => snapshot.unsubscribedAt !== null,
  );
  const complained = countWhere(
    snapshots,
    (snapshot) => snapshot.deliveryStatus === "complained",
  );

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
      subtitle: null,
    },
    {
      key: "delivered",
      label: "Delivered",
      value: delivered,
      percentage: formatPercentage(delivered, total),
      subtitle: "Postmark confirms",
    },
    {
      key: "opened",
      label: "Opened",
      value: opened,
      percentage: formatPercentage(opened, total),
      subtitle: null,
    },
    {
      key: "clicked",
      label: "Clicked",
      value: clicked,
      percentage: formatPercentage(clicked, total),
      subtitle: null,
    },
    {
      key: "bounced",
      label: "Bounced",
      value: bounced,
      percentage: formatPercentage(bounced, total),
      subtitle: null,
    },
    {
      key: "unsubscribed",
      label: "Unsubscribed",
      value: unsubscribed,
      percentage: formatPercentage(unsubscribed, total),
      subtitle: null,
    },
    {
      key: "complained",
      label: "Complained",
      value: complained,
      percentage: formatPercentage(complained, total),
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

  const snapshots =
    provider === "mailchimp"
      ? []
      : await runtime.campaigns.audienceSnapshots.listForRun(run.id);
  const totalAudience = run.audienceSize ?? snapshots.length;
  const metrics =
    provider === "mailchimp"
      ? buildHistoricalMetricTiles(totalAudience, run.state)
      : buildMetricTiles(snapshots, totalAudience);
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
  const recipients = snapshots.map((snapshot) => {
    const latestState = resolveRecipientLatestState(snapshot);
    return {
      snapshotId: snapshot.id,
      contactId: snapshot.contactId,
      name: snapshot.frozenFirstName ?? snapshot.frozenEmail,
      email: snapshot.frozenEmail,
      project: snapshot.frozenProjectName,
      latestState,
      latestStateLabel: recipientStateLabel(latestState),
      lastEventAt:
        snapshot.lastEventAt ??
        snapshot.clickedAt ??
        snapshot.openedAt ??
        snapshot.unsubscribedAt ??
        snapshot.complainedAt ??
        snapshot.bouncedAt ??
        snapshot.deliveredAt ??
        snapshot.sentAt,
    } satisfies RecipientRowData;
  });

  const replyContactIds = [
    ...new Set(snapshots.map((snapshot) => snapshot.contactId)),
  ];
  let repliesCount = 0;
  let recentReplies: readonly ReplyPreviewRow[] = [];
  if (
    runtime.connection !== null &&
    replyContactIds.length > 0 &&
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
      where cel.contact_id in (${sql.join(
        replyContactIds.map((value) => sql`${value}`),
        sql`, `,
      )})
        and cel.event_type = 'communication.email.inbound'
        and cel.occurred_at > ${threshold}::timestamptz
      order by cel.occurred_at desc, cel.id desc
      limit 5
    `);
    const countResult = await runtime.connection.db.execute(
      sql<{ readonly count: number }>`
        select count(*)::int as "count"
        from canonical_event_ledger cel
        where cel.contact_id in (${sql.join(
          replyContactIds.map((value) => sql`${value}`),
          sql`, `,
        )})
          and cel.event_type = 'communication.email.inbound'
          and cel.occurred_at > ${threshold}::timestamptz
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
