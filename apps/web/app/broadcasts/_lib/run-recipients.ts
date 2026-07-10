import { sql, type SQL } from "drizzle-orm";

import type { AudienceSnapshotRecord } from "@as-comms/contracts";

import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

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

function coerceIsoTimestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function coerceCount(value: number | string | bigint | null | undefined): number {
  return Number(value ?? 0);
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

export type RecipientFilter =
  | "all"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "unsubscribed"
  | "failed"
  | "suppressed";

export interface RecipientRowData {
  readonly snapshotId: string;
  readonly contactId: string | null;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
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
  readonly failed: number;
  readonly suppressed: number;
  readonly opened: number;
  readonly clicked: number;
  readonly bounced: number;
  readonly unsubscribed: number;
  readonly complained: number;
  readonly total: number;
}

export interface RunVariantMetricCounts {
  readonly subjectVariant: "a" | "b";
  readonly delivered: number;
  readonly opened: number;
  readonly clicked: number;
  readonly total: number;
}

export interface RunActivityBreakdown {
  readonly human: number;
  readonly bot: number;
  readonly hasEventData: boolean;
}

export interface RunEngagementBreakdown {
  readonly opens: RunActivityBreakdown;
  readonly clicks: RunActivityBreakdown;
}

interface MutableRunVariantMetricCounts {
  subjectVariant: "a" | "b";
  delivered: number;
  opened: number;
  clicked: number;
  total: number;
}

interface RunActivityBreakdownRow {
  readonly human: number | string | bigint | null;
  readonly bot: number | string | bigint | null;
  readonly totalRows: number | string | bigint | null;
}

interface RecipientRowDb {
  readonly snapshotId: string;
  readonly contactId: string | null;
  readonly name: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly project: string | null;
  readonly latestState: RecipientLatestState;
  readonly lastEventAt: Date | string | null;
}

interface SmsRecipientRowDb {
  readonly snapshotId: string;
  readonly contactId: string | null;
  readonly name: string | null;
  readonly phone: string | null;
  readonly latestState: RecipientLatestState;
  readonly lastEventAt: Date | string | null;
}

interface SmsMetricCountsRow {
  readonly queued: number;
  readonly sent: number;
  readonly delivered: number;
  readonly failed: number;
  readonly suppressed: number;
  readonly total: number;
}

interface MailchimpRecipientRowSource {
  readonly memberId: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly contactId: string | null;
  readonly latestState:
    | "sent"
    | "delivered"
    | "opened"
    | "clicked"
    | "bounced"
    | "unsubscribed";
  readonly latestEventAt: string;
}

function mapRunActivityBreakdown(
  row: RunActivityBreakdownRow | undefined,
): RunActivityBreakdown {
  const totalRows = coerceCount(row?.totalRows);

  return {
    human: coerceCount(row?.human),
    bot: coerceCount(row?.bot),
    hasEventData: totalRows > 0,
  };
}

const DEFAULT_RECIPIENT_LIMIT = 100;
const MAX_RECIPIENT_LIMIT = 200;

function isSubjectVariant(
  value: AudienceSnapshotRecord["subjectVariant"],
): value is RunVariantMetricCounts["subjectVariant"] {
  return value === "a" || value === "b";
}

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
    case "failed":
      return state === "failed";
    case "suppressed":
      return state === "suppressed";
  }
}

function mapSnapshot(snapshot: AudienceSnapshotRecord): RecipientRowData {
  const latestState = resolveRecipientLatestState(snapshot);
  return {
    snapshotId: snapshot.id,
    contactId: snapshot.contactId,
    name: snapshot.frozenFirstName ?? snapshot.frozenEmail,
    email: snapshot.frozenEmail,
    phone: null,
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
    case "failed":
      conditions.push(sql`delivery_status = 'failed'`);
      break;
    case "suppressed":
      conditions.push(sql`delivery_status = 'suppressed_at_send'`);
      break;
  }

  return sql`where ${sql.join(conditions, sql` and `)}`;
}

function mapRecipientRow(row: RecipientRowDb): RecipientRowData {
  return {
    snapshotId: row.snapshotId,
    contactId: row.contactId,
    name: row.name ?? row.email ?? "Unknown recipient",
    email: row.email,
    phone: row.phone,
    project: row.project,
    latestState: row.latestState,
    latestStateLabel: recipientStateLabel(row.latestState),
    lastEventAt: coerceIsoTimestamp(row.lastEventAt),
  };
}

function mapSmsRecipientRow(row: SmsRecipientRowDb): RecipientRowData {
  return {
    snapshotId: row.snapshotId,
    contactId: row.contactId,
    name: row.name ?? row.phone ?? "Unknown recipient",
    email: null,
    phone: row.phone,
    project: null,
    latestState: row.latestState,
    latestStateLabel: recipientStateLabel(row.latestState),
    lastEventAt: coerceIsoTimestamp(row.lastEventAt),
  };
}

function mapMailchimpRecipientRow(
  row: MailchimpRecipientRowSource,
): RecipientRowData {
  return {
    snapshotId: row.memberId,
    contactId: row.contactId,
    name: row.displayName ?? row.email ?? row.memberId,
    email: row.email,
    phone: null,
    project: null,
    latestState: row.latestState,
    latestStateLabel: recipientStateLabel(row.latestState),
    lastEventAt: row.latestEventAt,
  };
}

function matchesMailchimpQuery(
  row: MailchimpRecipientRowSource,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return true;
  }

  return [row.memberId, row.displayName ?? "", row.email ?? ""].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

function getMailchimpCampaignRepository(
  runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>,
) {
  return runtime.repositories.mailchimpCampaignActivityDetails;
}

export async function listRunRecipients(input: {
  readonly runId: string;
  readonly provider?: "postmark" | "mailchimp" | "sms";
  readonly filter?: RecipientFilter;
  readonly query?: string;
  readonly limit?: number;
  readonly offset?: number;
}): Promise<RecipientQueryResult> {
  const runtime = await getStage1WebRuntime();
  const provider = input.provider ?? "postmark";
  const filter = input.filter ?? "all";
  const query = input.query ?? "";
  const limit = clampLimit(input.limit);
  const offset = normalizeOffset(input.offset);

  if (provider === "mailchimp") {
    const repository = getMailchimpCampaignRepository(runtime);
    const mailchimpFilter =
      filter === "failed" || filter === "suppressed" ? "all" : filter;

    if (query.trim().length === 0) {
      const result = await repository.listRecipientsForCampaign(input.runId, {
        limit,
        offset,
        filter: mailchimpFilter,
      });
      return {
        rows: result.rows.map(mapMailchimpRecipientRow),
        total: result.total,
      };
    }

    const allRows: MailchimpRecipientRowSource[] = [];
    let currentOffset = 0;
    let total = 0;

    do {
      const page = await repository.listRecipientsForCampaign(input.runId, {
        limit: MAX_RECIPIENT_LIMIT,
        offset: currentOffset,
        filter: mailchimpFilter,
      });
      allRows.push(...page.rows);
      total = page.total;
      currentOffset += page.rows.length;
      if (page.rows.length === 0) {
        break;
      }
    } while (currentOffset < total);

    const filtered = allRows.filter((row) => matchesMailchimpQuery(row, query));
    return {
      rows: filtered.slice(offset, offset + limit).map(mapMailchimpRecipientRow),
      total: filtered.length,
    };
  }

  if (provider === "sms") {
    if (runtime.connection === null) {
      return { rows: [], total: 0 };
    }

    const conditions: SQL[] = [
      sql`sms.broadcast_run_id = ${input.runId}`,
      sql`sms.direction = 'outbound'`,
    ];
    const normalizedQuery = query.trim();

    if (normalizedQuery.length > 0) {
      const pattern = `%${normalizedQuery}%`;
      conditions.push(sql`(
        coalesce(c.display_name, sms.phone_e164) ilike ${pattern}
        or sms.phone_e164 ilike ${pattern}
      )`);
    }

    switch (filter) {
      case "all":
        break;
      case "sent":
        conditions.push(
          sql`sms.send_status in ('sent', 'delivered', 'undelivered')`,
        );
        break;
      case "delivered":
        conditions.push(sql`sms.send_status = 'delivered'`);
        break;
      case "failed":
      case "bounced":
        conditions.push(sql`sms.send_status in ('failed', 'undelivered')`);
        break;
      case "suppressed":
      case "unsubscribed":
        conditions.push(sql`sms.send_status = 'suppressed'`);
        break;
      case "opened":
      case "clicked":
        return { rows: [], total: 0 };
    }

    const whereClause = sql`where ${sql.join(conditions, sql` and `)}`;
    const [rowsResult, countResult] = await Promise.all([
      runtime.connection.db.execute(sql<SmsRecipientRowDb>`
        select
          sms.id as "snapshotId",
          sms.contact_id as "contactId",
          c.display_name as "name",
          sms.phone_e164 as "phone",
          case
            when sms.send_status = 'delivered' then 'delivered'
            when sms.send_status = 'sent' then 'sent'
            when sms.send_status = 'undelivered' then 'failed'
            when sms.send_status = 'failed' then 'failed'
            when sms.send_status = 'suppressed' then 'suppressed'
            else 'queued'
          end as "latestState",
          coalesce(sms.sent_at, sms.created_at) as "lastEventAt"
        from sms_messages sms
        left join contacts c
          on c.id = sms.contact_id
        ${whereClause}
        order by sms.created_at asc, sms.id asc
        limit ${limit}
        offset ${offset}
      `),
      runtime.connection.db.execute(sql<{ readonly count: number | string }>`
        select count(*)::int as "count"
        from sms_messages sms
        left join contacts c
          on c.id = sms.contact_id
        ${whereClause}
      `),
    ]);

    const rows = normalizeSqlResultRows<SmsRecipientRowDb>(
      rowsResult as { readonly rows?: readonly SmsRecipientRowDb[] },
    );
    const [countRow] = normalizeSqlResultRows<{ readonly count: number | string }>(
      countResult as {
        readonly rows?: readonly { readonly count: number | string }[];
      },
    );

    return {
      rows: rows.map(mapSmsRecipientRow),
      total: Number(countRow?.count ?? 0),
    };
  }

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
        null::text as "phone",
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

  const rows = normalizeSqlResultRows<RecipientRowDb>(
    rowsResult as { readonly rows?: readonly RecipientRowDb[] },
  );
  const [countRow] = normalizeSqlResultRows<{
    readonly count: number | string;
  }>(
    countResult as {
      readonly rows?: readonly { readonly count: number | string }[];
    },
  );

  return {
    rows: rows.map(mapRecipientRow),
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
      count(*) filter (where delivery_status = 'failed')::int as "failed",
      0::int as "suppressed",
      count(*) filter (where opened_at is not null)::int as "opened",
      count(*) filter (where clicked_at is not null)::int as "clicked",
      count(*) filter (where delivery_status = 'bounced')::int as "bounced",
      count(*) filter (where unsubscribed_at is not null)::int as "unsubscribed",
      count(*) filter (where delivery_status = 'complained')::int as "complained",
      count(*)::int as "total"
    from audience_snapshots
    where campaign_run_id = ${input.runId}
  `);
  const [row] = normalizeSqlResultRows<RunMetricCounts>(
    result as { readonly rows?: readonly RunMetricCounts[] },
  );

  return (
    row ?? {
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
    }
  );
}

export async function readSmsRunMetricCounts(input: {
  readonly runId: string;
}): Promise<RunMetricCounts> {
  const runtime = await getStage1WebRuntime();

  if (runtime.connection === null) {
    return {
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
  }

  const result = await runtime.connection.db.execute(sql<SmsMetricCountsRow>`
    select
      count(*) filter (where send_status = 'queued')::int as "queued",
      count(*) filter (
        where send_status in ('sent', 'delivered', 'undelivered')
      )::int as "sent",
      count(*) filter (where send_status = 'delivered')::int as "delivered",
      count(*) filter (
        where send_status in ('failed', 'undelivered')
      )::int as "failed",
      count(*) filter (where send_status = 'suppressed')::int as "suppressed",
      count(*)::int as "total"
    from sms_messages
    where broadcast_run_id = ${input.runId}
      and direction = 'outbound'
      and send_status <> 'received'
  `);
  const [row] = normalizeSqlResultRows<SmsMetricCountsRow>(
    result as { readonly rows?: readonly SmsMetricCountsRow[] },
  );

  return {
    queued: row?.queued ?? 0,
    sent: row?.sent ?? 0,
    delivered: row?.delivered ?? 0,
    failed: row?.failed ?? 0,
    suppressed: row?.suppressed ?? 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    unsubscribed: 0,
    complained: 0,
    total: row?.total ?? 0,
  };
}

export async function readRunVariantMetricCounts(input: {
  readonly runId: string;
}): Promise<readonly RunVariantMetricCounts[]> {
  const runtime = await getStage1WebRuntime();

  if (runtime.connection === null) {
    const snapshots = await runtime.campaigns.audienceSnapshots.listForRun(
      input.runId,
    );
    return countSnapshotsBySubjectVariant(snapshots);
  }

  const result = await runtime.connection.db.execute(sql<{
    readonly subjectVariant: "a" | "b" | null;
    readonly delivered: number | string;
    readonly opened: number | string;
    readonly clicked: number | string;
    readonly total: number | string;
  }>`
    select
      subject_variant as "subjectVariant",
      count(*) filter (
        where delivery_status = 'delivered'
          or opened_at is not null
          or clicked_at is not null
      )::int as "delivered",
      count(*) filter (where opened_at is not null)::int as "opened",
      count(*) filter (where clicked_at is not null)::int as "clicked",
      count(*)::int as "total"
    from audience_snapshots
    where campaign_run_id = ${input.runId}
      and subject_variant is not null
    group by subject_variant
    order by subject_variant asc
  `);
  const rows = normalizeSqlResultRows<{
    readonly subjectVariant: "a" | "b" | null;
    readonly delivered: number | string;
    readonly opened: number | string;
    readonly clicked: number | string;
    readonly total: number | string;
  }>(result as {
    readonly rows?: readonly {
      readonly subjectVariant: "a" | "b" | null;
      readonly delivered: number | string;
      readonly opened: number | string;
      readonly clicked: number | string;
      readonly total: number | string;
    }[];
  });

  return rows.flatMap((row) =>
    isSubjectVariant(row.subjectVariant)
      ? [
          {
            subjectVariant: row.subjectVariant,
            delivered: Number(row.delivered),
            opened: Number(row.opened),
            clicked: Number(row.clicked),
            total: Number(row.total),
          } satisfies RunVariantMetricCounts,
        ]
      : [],
  );
}

export async function readRunEngagementBreakdown(
  runId: string,
): Promise<RunEngagementBreakdown> {
  const runtime = await getStage1WebRuntime();

  if (runtime.connection === null) {
    return {
      opens: { human: 0, bot: 0, hasEventData: false },
      clicks: { human: 0, bot: 0, hasEventData: false },
    };
  }

  const [opensResult, clicksResult] = await Promise.all([
    runtime.connection.db.execute(sql<RunActivityBreakdownRow>`
      select
        count(distinct rk) filter (where not is_bot) as "human",
        count(distinct rk) - count(distinct rk) filter (where not is_bot) as "bot",
        count(*) as "totalRows"
      from (
        select coalesce(contact_id, audience_snapshot_id, id) as rk, is_bot
        from broadcast_opens
        where campaign_run_id = ${runId}
      ) t
    `),
    runtime.connection.db.execute(sql<RunActivityBreakdownRow>`
      select
        count(distinct rk) filter (where not is_bot) as "human",
        count(distinct rk) - count(distinct rk) filter (where not is_bot) as "bot",
        count(*) as "totalRows"
      from (
        select coalesce(contact_id, audience_snapshot_id, id) as rk, is_bot
        from broadcast_link_clicks
        where campaign_run_id = ${runId}
      ) t
    `),
  ]);

  const [opensRow] = normalizeSqlResultRows<RunActivityBreakdownRow>(
    opensResult as { readonly rows?: readonly RunActivityBreakdownRow[] },
  );
  const [clicksRow] = normalizeSqlResultRows<RunActivityBreakdownRow>(
    clicksResult as { readonly rows?: readonly RunActivityBreakdownRow[] },
  );

  return {
    opens: mapRunActivityBreakdown(opensRow),
    clicks: mapRunActivityBreakdown(clicksRow),
  };
}

export function countSnapshots(
  snapshots: readonly AudienceSnapshotRecord[],
): RunMetricCounts {
  let queued = 0;
  let sent = 0;
  let delivered = 0;
  let failed = 0;
  let suppressed = 0;
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
    if (snapshot.deliveryStatus === "failed") {
      failed += 1;
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
    if (snapshot.deliveryStatus === "suppressed_at_send") {
      suppressed += 1;
    }
  }

  return {
    queued,
    sent,
    delivered,
    failed,
    suppressed,
    opened,
    clicked,
    bounced,
    unsubscribed,
    complained,
    total: snapshots.length,
  };
}

export function countSnapshotsBySubjectVariant(
  snapshots: readonly AudienceSnapshotRecord[],
): readonly RunVariantMetricCounts[] {
  const countsByVariant: Record<
    RunVariantMetricCounts["subjectVariant"],
    MutableRunVariantMetricCounts
  > = {
    a: { subjectVariant: "a", delivered: 0, opened: 0, clicked: 0, total: 0 },
    b: { subjectVariant: "b", delivered: 0, opened: 0, clicked: 0, total: 0 },
  };

  for (const snapshot of snapshots) {
    if (!isSubjectVariant(snapshot.subjectVariant)) {
      continue;
    }

    const counts = countsByVariant[snapshot.subjectVariant];
    counts.total += 1;

    if (
      snapshot.deliveryStatus === "delivered" ||
      snapshot.openedAt !== null ||
      snapshot.clickedAt !== null
    ) {
      counts.delivered += 1;
    }
    if (snapshot.openedAt !== null) {
      counts.opened += 1;
    }
    if (snapshot.clickedAt !== null) {
      counts.clicked += 1;
    }
  }

  return Object.values(countsByVariant).filter((counts) => counts.total > 0);
}
