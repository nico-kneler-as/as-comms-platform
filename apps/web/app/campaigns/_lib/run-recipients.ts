import { sql, type SQL } from "drizzle-orm";

import type { AudienceSnapshotRecord } from "@as-comms/contracts";

import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

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

export type RecipientFilter =
  | "all"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "unsubscribed";

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

export interface RecipientQueryResult {
  readonly rows: readonly RecipientRowData[];
  readonly total: number;
}

export interface RunMetricCounts {
  readonly queued: number;
  readonly sent: number;
  readonly delivered: number;
  readonly opened: number;
  readonly clicked: number;
  readonly bounced: number;
  readonly unsubscribed: number;
  readonly complained: number;
  readonly total: number;
}

interface RecipientRowDb {
  readonly snapshotId: string;
  readonly contactId: string;
  readonly name: string | null;
  readonly email: string;
  readonly project: string | null;
  readonly latestState: RecipientLatestState;
  readonly lastEventAt: Date | null;
}

const DEFAULT_RECIPIENT_LIMIT = 100;
const MAX_RECIPIENT_LIMIT = 200;

export function resolveRecipientLatestState(
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

export function recipientStateLabel(state: RecipientLatestState): string {
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

function clampLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_RECIPIENT_LIMIT;
  }

  return Math.min(MAX_RECIPIENT_LIMIT, Math.max(1, Math.floor(limit)));
}

function normalizeOffset(offset?: number): number {
  if (offset === undefined || !Number.isFinite(offset)) {
    return 0;
  }

  return Math.max(0, Math.floor(offset));
}

function matchesFilter(
  snapshot: AudienceSnapshotRecord,
  filter: RecipientFilter,
): boolean {
  const state = resolveRecipientLatestState(snapshot);
  switch (filter) {
    case "all":
      return true;
    case "sent":
      return (
        state === "sent" ||
        state === "delivered" ||
        state === "opened" ||
        state === "clicked"
      );
    case "delivered":
      return state === "delivered" || state === "opened" || state === "clicked";
    case "opened":
      return state === "opened" || state === "clicked";
    case "clicked":
      return state === "clicked";
    case "bounced":
      return state === "bounced";
    case "unsubscribed":
      return state === "unsubscribed";
  }
}

function mapSnapshot(snapshot: AudienceSnapshotRecord): RecipientRowData {
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
  };
}

function filterSnapshots(input: {
  readonly snapshots: readonly AudienceSnapshotRecord[];
  readonly filter: RecipientFilter;
  readonly query: string;
}): readonly AudienceSnapshotRecord[] {
  const normalizedQuery = input.query.trim().toLowerCase();
  return input.snapshots.filter((snapshot) => {
    if (!matchesFilter(snapshot, input.filter)) {
      return false;
    }

    if (normalizedQuery.length === 0) {
      return true;
    }

    const name = snapshot.frozenFirstName ?? snapshot.frozenEmail;
    return (
      name.toLowerCase().includes(normalizedQuery) ||
      snapshot.frozenEmail.toLowerCase().includes(normalizedQuery) ||
      (snapshot.frozenProjectName ?? "").toLowerCase().includes(normalizedQuery)
    );
  });
}

function buildRecipientWhere(input: {
  readonly runId: string;
  readonly filter: RecipientFilter;
  readonly query: string;
}): SQL {
  const conditions: SQL[] = [sql`campaign_run_id = ${input.runId}`];
  const normalizedQuery = input.query.trim();

  if (normalizedQuery.length > 0) {
    const pattern = `%${normalizedQuery}%`;
    conditions.push(sql`(
      coalesce(nullif(frozen_first_name, ''), frozen_email) ilike ${pattern}
      or frozen_email ilike ${pattern}
      or coalesce(frozen_project_name, '') ilike ${pattern}
    )`);
  }

  switch (input.filter) {
    case "all":
      break;
    case "sent":
      conditions.push(sql`(
        sent_at is not null
        or delivery_status in ('sent', 'delivered', 'bounced', 'complained', 'unsubscribed')
      )`);
      break;
    case "delivered":
      conditions.push(
        sql`(delivery_status = 'delivered' or opened_at is not null or clicked_at is not null)`,
      );
      break;
    case "opened":
      conditions.push(sql`(opened_at is not null or clicked_at is not null)`);
      break;
    case "clicked":
      conditions.push(sql`clicked_at is not null`);
      break;
    case "bounced":
      conditions.push(sql`delivery_status = 'bounced'`);
      break;
    case "unsubscribed":
      conditions.push(sql`unsubscribed_at is not null`);
      break;
  }

  return sql`where ${sql.join(conditions, sql` and `)}`;
}

function mapRecipientRow(row: RecipientRowDb): RecipientRowData {
  return {
    snapshotId: row.snapshotId,
    contactId: row.contactId,
    name: row.name ?? row.email,
    email: row.email,
    project: row.project,
    latestState: row.latestState,
    latestStateLabel: recipientStateLabel(row.latestState),
    lastEventAt: row.lastEventAt?.toISOString() ?? null,
  };
}

export async function listRunRecipients(input: {
  readonly runId: string;
  readonly filter?: RecipientFilter;
  readonly query?: string;
  readonly limit?: number;
  readonly offset?: number;
}): Promise<RecipientQueryResult> {
  const runtime = await getStage1WebRuntime();
  const filter = input.filter ?? "all";
  const query = input.query ?? "";
  const limit = clampLimit(input.limit);
  const offset = normalizeOffset(input.offset);

  if (runtime.connection === null) {
    const snapshots = await runtime.campaigns.audienceSnapshots.listForRun(
      input.runId,
    );
    const filtered = filterSnapshots({ snapshots, filter, query });
    return {
      rows: filtered.slice(offset, offset + limit).map(mapSnapshot),
      total: filtered.length,
    };
  }

  const whereClause = buildRecipientWhere({
    runId: input.runId,
    filter,
    query,
  });
  const [rowsResult, countResult] = await Promise.all([
    runtime.connection.db.execute(sql<RecipientRowDb>`
      select
        id as "snapshotId",
        contact_id as "contactId",
        coalesce(nullif(frozen_first_name, ''), frozen_email) as "name",
        frozen_email as "email",
        frozen_project_name as "project",
        case
          when clicked_at is not null then 'clicked'
          when opened_at is not null then 'opened'
          when unsubscribed_at is not null then 'unsubscribed'
          when delivery_status = 'complained' then 'complained'
          when delivery_status = 'bounced' then 'bounced'
          when delivery_status = 'delivered' then 'delivered'
          when delivery_status = 'sent' then 'sent'
          when delivery_status = 'failed' then 'failed'
          when delivery_status = 'suppressed_at_send' then 'suppressed'
          else 'queued'
        end as "latestState",
        coalesce(
          last_event_at,
          clicked_at,
          opened_at,
          unsubscribed_at,
          complained_at,
          bounced_at,
          delivered_at,
          sent_at
        ) as "lastEventAt"
      from audience_snapshots
      ${whereClause}
      order by created_at asc, id asc
      limit ${limit}
      offset ${offset}
    `),
    runtime.connection.db.execute(sql<{ readonly count: number | string }>`
      select count(*)::int as "count"
      from audience_snapshots
      ${whereClause}
    `),
  ]);

  const rows = (rowsResult as { readonly rows?: readonly RecipientRowDb[] })
    .rows;
  const [countRow] =
    (
      countResult as {
        readonly rows?: readonly { readonly count: number | string }[];
      }
    ).rows ?? [];

  return {
    rows: (rows ?? []).map(mapRecipientRow),
    total: Number(countRow?.count ?? 0),
  };
}

export async function readRunMetricCounts(input: {
  readonly runId: string;
}): Promise<RunMetricCounts> {
  const runtime = await getStage1WebRuntime();

  if (runtime.connection === null) {
    const snapshots = await runtime.campaigns.audienceSnapshots.listForRun(
      input.runId,
    );
    return countSnapshots(snapshots);
  }

  const result = await runtime.connection.db.execute(sql<RunMetricCounts>`
    select
      count(*) filter (where delivery_status = 'pending')::int as "queued",
      count(*) filter (
        where sent_at is not null
          or delivery_status in ('sent', 'delivered', 'bounced', 'complained', 'unsubscribed')
      )::int as "sent",
      count(*) filter (
        where delivery_status = 'delivered'
          or opened_at is not null
          or clicked_at is not null
      )::int as "delivered",
      count(*) filter (where opened_at is not null)::int as "opened",
      count(*) filter (where clicked_at is not null)::int as "clicked",
      count(*) filter (where delivery_status = 'bounced')::int as "bounced",
      count(*) filter (where unsubscribed_at is not null)::int as "unsubscribed",
      count(*) filter (where delivery_status = 'complained')::int as "complained",
      count(*)::int as "total"
    from audience_snapshots
    where campaign_run_id = ${input.runId}
  `);
  const [row] =
    (result as { readonly rows?: readonly RunMetricCounts[] }).rows ?? [];

  return (
    row ?? {
      queued: 0,
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      unsubscribed: 0,
      complained: 0,
      total: 0,
    }
  );
}

export function countSnapshots(
  snapshots: readonly AudienceSnapshotRecord[],
): RunMetricCounts {
  let queued = 0;
  let sent = 0;
  let delivered = 0;
  let opened = 0;
  let clicked = 0;
  let bounced = 0;
  let unsubscribed = 0;
  let complained = 0;

  for (const snapshot of snapshots) {
    if (snapshot.deliveryStatus === "pending") {
      queued += 1;
    }
    if (
      snapshot.sentAt !== null ||
      snapshot.deliveryStatus === "sent" ||
      snapshot.deliveryStatus === "delivered" ||
      snapshot.deliveryStatus === "bounced" ||
      snapshot.deliveryStatus === "complained" ||
      snapshot.deliveryStatus === "unsubscribed"
    ) {
      sent += 1;
    }
    if (
      snapshot.deliveryStatus === "delivered" ||
      snapshot.openedAt !== null ||
      snapshot.clickedAt !== null
    ) {
      delivered += 1;
    }
    if (snapshot.openedAt !== null) {
      opened += 1;
    }
    if (snapshot.clickedAt !== null) {
      clicked += 1;
    }
    if (snapshot.deliveryStatus === "bounced") {
      bounced += 1;
    }
    if (snapshot.unsubscribedAt !== null) {
      unsubscribed += 1;
    }
    if (snapshot.deliveryStatus === "complained") {
      complained += 1;
    }
  }

  return {
    queued,
    sent,
    delivered,
    opened,
    clicked,
    bounced,
    unsubscribed,
    complained,
    total: snapshots.length,
  };
}
