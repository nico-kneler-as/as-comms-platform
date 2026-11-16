import { sql } from "drizzle-orm";

import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import {
  buildRecipientWhere,
  listRunRecipients,
  readRunMetricCounts,
  recipientStateLabel,
  type RecipientFilter,
  type RecipientLatestState,
  type RunMetricCounts,
} from "./run-recipients";

/**
 * Per-recipient results of one send, for the "Download CSV" button and the MCP
 * broadcast tools. Same filter/search and the same "latest state" as the
 * recipients table, plus the individual event dates.
 */
export interface RecipientResultRow {
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly project: string | null;
  readonly result: RecipientLatestState;
  readonly resultLabel: string;
  readonly sentAt: string | null;
  readonly deliveredAt: string | null;
  readonly openedAt: string | null;
  readonly clickedAt: string | null;
  readonly bouncedAt: string | null;
  readonly unsubscribedAt: string | null;
  readonly markedSpamAt: string | null;
  readonly lastEventAt: string | null;
}

export type BroadcastProvider = "postmark" | "mailchimp" | "sms";

interface RecipientResultDbRow {
  readonly name: string | null;
  readonly email: string | null;
  readonly project: string | null;
  readonly result: RecipientLatestState;
  readonly sentAt: Date | string | null;
  readonly deliveredAt: Date | string | null;
  readonly openedAt: Date | string | null;
  readonly clickedAt: Date | string | null;
  readonly bouncedAt: Date | string | null;
  readonly unsubscribedAt: Date | string | null;
  readonly markedSpamAt: Date | string | null;
  readonly lastEventAt: Date | string | null;
}

const PAGE_SIZE = 200;

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function readRows(result: unknown): readonly unknown[] {
  if (Array.isArray(result)) return result as readonly unknown[];
  return (result as { readonly rows?: readonly unknown[] }).rows ?? [];
}

/**
 * Email sends read every event date from the snapshots. SMS and Mailchimp
 * history fall back to the table's rows (state and last event only).
 * `limit` undefined means every matching recipient (the CSV).
 */
export async function listRunRecipientResults(input: {
  readonly runId: string;
  readonly provider: BroadcastProvider;
  readonly filter?: RecipientFilter;
  readonly query?: string;
  readonly limit?: number;
  readonly offset?: number;
}): Promise<{ readonly rows: readonly RecipientResultRow[]; readonly total: number }> {
  const filter = input.filter ?? "all";
  const query = input.query ?? "";
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const runtime = await getStage1WebRuntime();

  if (input.provider === "postmark" && runtime.connection !== null) {
    const where = buildRecipientWhere({ runId: input.runId, filter, query });
    const limitClause =
      input.limit === undefined
        ? sql``
        : sql`limit ${Math.max(1, Math.floor(input.limit))}`;
    const [rowsResult, countResult] = await Promise.all([
      runtime.connection.db.execute(sql`
        select
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
          end as "result",
          sent_at as "sentAt",
          coalesce(delivered_at, case when opened_at is not null or clicked_at is not null then sent_at end) as "deliveredAt",
          opened_at as "openedAt",
          clicked_at as "clickedAt",
          bounced_at as "bouncedAt",
          unsubscribed_at as "unsubscribedAt",
          complained_at as "markedSpamAt",
          coalesce(last_event_at, clicked_at, opened_at, unsubscribed_at, complained_at, bounced_at, delivered_at, sent_at) as "lastEventAt"
        from audience_snapshots
        ${where}
        order by lower(frozen_email) asc, id asc
        ${limitClause}
        offset ${offset}
      `),
      runtime.connection.db.execute(sql`
        select count(*)::int as "count" from audience_snapshots ${where}
      `),
    ]);
    const [countRow] = readRows(countResult) as readonly {
      readonly count: number | string;
    }[];

    return {
      rows: (readRows(rowsResult) as readonly RecipientResultDbRow[]).map((row) => ({
        name: row.name ?? row.email ?? "Unknown recipient",
        email: row.email,
        phone: null,
        project: row.project,
        result: row.result,
        resultLabel: recipientStateLabel(row.result),
        sentAt: toIso(row.sentAt),
        deliveredAt: toIso(row.deliveredAt),
        openedAt: toIso(row.openedAt),
        clickedAt: toIso(row.clickedAt),
        bouncedAt: toIso(row.bouncedAt),
        unsubscribedAt: toIso(row.unsubscribedAt),
        markedSpamAt: toIso(row.markedSpamAt),
        lastEventAt: toIso(row.lastEventAt),
      })),
      total: Number(countRow?.count ?? 0),
    };
  }

  // SMS / Mailchimp: page through the table's reader.
  const wanted = input.limit ?? Number.POSITIVE_INFINITY;
  const rows: RecipientResultRow[] = [];
  let pageOffset = offset;
  let total = 0;
  while (rows.length < wanted) {
    const page = await listRunRecipients({
      runId: input.runId,
      provider: input.provider,
      filter,
      query,
      limit: Math.min(PAGE_SIZE, wanted - rows.length),
      offset: pageOffset,
    });
    total = page.total;
    for (const row of page.rows) {
      rows.push({
        name: row.name,
        email: row.email,
        phone: row.phone,
        project: row.project,
        result: row.latestState,
        resultLabel: row.latestStateLabel,
        sentAt: null,
        deliveredAt: null,
        openedAt: null,
        clickedAt: null,
        bouncedAt: null,
        unsubscribedAt: null,
        markedSpamAt: null,
        lastEventAt: row.lastEventAt,
      });
    }
    pageOffset += page.rows.length;
    if (page.rows.length === 0 || pageOffset >= total) break;
  }
  return { rows, total };
}

const CSV_COLUMNS: readonly {
  readonly header: string;
  readonly read: (row: RecipientResultRow) => string | null;
}[] = [
  { header: "Name", read: (row) => row.name },
  { header: "Email", read: (row) => row.email },
  { header: "Phone", read: (row) => row.phone },
  { header: "Project", read: (row) => row.project },
  { header: "Result", read: (row) => row.resultLabel },
  { header: "Sent at (UTC)", read: (row) => row.sentAt },
  { header: "Delivered at (UTC)", read: (row) => row.deliveredAt },
  { header: "Opened at (UTC)", read: (row) => row.openedAt },
  { header: "Clicked at (UTC)", read: (row) => row.clickedAt },
  { header: "Bounced at (UTC)", read: (row) => row.bouncedAt },
  { header: "Unsubscribed at (UTC)", read: (row) => row.unsubscribedAt },
  { header: "Marked as spam at (UTC)", read: (row) => row.markedSpamAt },
  { header: "Last event at (UTC)", read: (row) => row.lastEventAt },
];

function csvCell(value: string | null): string {
  if (value === null) return "";
  // A leading = + - @ makes spreadsheets evaluate the cell as a formula.
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return /[",\n\r]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** RFC 4180 CSV with a header row; CRLF line endings for Excel. */
export function buildRecipientResultsCsv(
  rows: readonly RecipientResultRow[],
): string {
  const lines = [
    CSV_COLUMNS.map((column) => column.header).join(","),
    ...rows.map((row) =>
      CSV_COLUMNS.map((column) => csvCell(column.read(row))).join(","),
    ),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export interface BroadcastSummary {
  readonly runId: string;
  readonly name: string | null;
  readonly state: string;
  readonly channel: "email" | "sms";
  readonly fromEmail: string | null;
  readonly fromName: string | null;
  readonly sentAt: string | null;
  readonly audienceSize: number | null;
  readonly metrics: RunMetricCounts | null;
}

/** Recent non-draft sends, newest first, optionally matching a name. */
export async function findBroadcasts(input: {
  readonly query?: string;
  readonly limit: number;
}): Promise<readonly BroadcastSummary[]> {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) return [];
  const query = input.query?.trim() ?? "";
  const nameFilter =
    query.length === 0 ? sql`` : sql`and coalesce(name, '') ilike ${`%${query}%`}`;
  const result = await runtime.connection.db.execute(sql`
    select id, name, state, launch_type as "launchType", from_email as "fromEmail",
      from_name as "fromName", coalesce(started_at, scheduled_at, created_at) as "sentAt",
      audience_size as "audienceSize"
    from campaign_runs
    where state <> 'draft' ${nameFilter}
    order by coalesce(started_at, scheduled_at, created_at) desc
    limit ${Math.max(1, Math.floor(input.limit))}
  `);
  const rows = readRows(result) as readonly {
    readonly id: string;
    readonly name: string | null;
    readonly state: string;
    readonly launchType: string;
    readonly fromEmail: string | null;
    readonly fromName: string | null;
    readonly sentAt: Date | string | null;
    readonly audienceSize: number | null;
  }[];

  return Promise.all(
    rows.map(async (row) => ({
      runId: row.id,
      name: row.name,
      state: row.state,
      channel: row.launchType === "sms" ? ("sms" as const) : ("email" as const),
      fromEmail: row.fromEmail,
      fromName: row.fromName,
      sentAt: toIso(row.sentAt),
      audienceSize: row.audienceSize,
      metrics:
        row.launchType === "sms"
          ? null
          : await readRunMetricCounts({ runId: row.id }),
    })),
  );
}
