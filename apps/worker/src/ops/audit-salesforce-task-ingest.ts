#!/usr/bin/env tsx
import process from "node:process";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  type PostgresClient
} from "@as-comms/db";

import {
  buildSalesforceTaskAuditReport,
  formatSnippetPreview,
  type SalesforceTaskAuditRow
} from "./_salesforce-task-audit.js";
import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readOptionalIntegerFlag
} from "./helpers.js";

interface SalesforceTaskAuditRowRaw {
  readonly canonical_event_id: string;
  readonly source_evidence_id: string;
  readonly provider_record_id: string;
  readonly payload_ref: string;
  readonly contact_id: string;
  readonly display_name: string;
  readonly salesforce_contact_id: string | null;
  readonly membership_count: number;
  readonly projects: string | null;
  readonly message_kind: "auto" | "one_to_one" | "campaign";
  readonly subject: string | null;
  readonly snippet: string;
  readonly source_label: string;
  readonly occurred_at: string;
  readonly subject_event_count: number;
  readonly subject_contact_count: number;
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or WORKER_DATABASE_URL is required for this ops command."
    );
  }

  return connectionString;
}

async function loadSalesforceTaskAuditRows(
  sql: PostgresClient
): Promise<readonly SalesforceTaskAuditRow[]> {
  const rows = await sql.unsafe<SalesforceTaskAuditRowRaw[]>(`
    with membership_projects as (
      select
        cm.contact_id,
        count(*)::int as membership_count,
        string_agg(
          distinct coalesce(pd.project_name, cm.project_id, '[unknown project]'),
          ' | '
          order by coalesce(pd.project_name, cm.project_id, '[unknown project]')
        ) as projects
      from contact_memberships cm
      left join project_dimensions pd
        on pd.project_id = cm.project_id
      group by cm.contact_id
    ),
    subject_stats as (
      select
        scd.subject,
        count(*)::int as subject_event_count,
        count(distinct cel.contact_id)::int as subject_contact_count
      from canonical_event_ledger cel
      join salesforce_communication_details scd
        on scd.source_evidence_id = cel.source_evidence_id
      where cel.event_type = 'communication.email.outbound'
        and cel.provenance ->> 'primaryProvider' = 'salesforce'
      group by scd.subject
    )
    select
      cel.id as canonical_event_id,
      cel.source_evidence_id,
      se.provider_record_id,
      se.payload_ref,
      cel.contact_id,
      c.display_name,
      c.salesforce_contact_id,
      coalesce(mp.membership_count, 0)::int as membership_count,
      mp.projects,
      scd.message_kind,
      scd.subject,
      scd.snippet,
      scd.source_label,
      cel.occurred_at,
      ss.subject_event_count,
      ss.subject_contact_count
    from canonical_event_ledger cel
    join source_evidence_log se
      on se.id = cel.source_evidence_id
    join salesforce_communication_details scd
      on scd.source_evidence_id = cel.source_evidence_id
    join contacts c
      on c.id = cel.contact_id
    left join membership_projects mp
      on mp.contact_id = cel.contact_id
    left join subject_stats ss
      on ss.subject is not distinct from scd.subject
    where cel.event_type = 'communication.email.outbound'
      and cel.provenance ->> 'primaryProvider' = 'salesforce'
    order by cel.occurred_at desc, cel.id desc
  `);

  return rows.map((row) => ({
    canonicalEventId: row.canonical_event_id,
    sourceEvidenceId: row.source_evidence_id,
    providerRecordId: row.provider_record_id,
    payloadRef: row.payload_ref,
    contactId: row.contact_id,
    displayName: row.display_name,
    salesforceContactId: row.salesforce_contact_id,
    membershipCount: row.membership_count,
    projects: row.projects,
    messageKind: row.message_kind,
    subject: row.subject,
    snippet: row.snippet,
    sourceLabel: row.source_label,
    occurredAt: row.occurred_at,
    subjectEventCount: row.subject_event_count,
    subjectContactCount: row.subject_contact_count
  }));
}

function buildSampleLine(
  row: ReturnType<typeof buildSalesforceTaskAuditReport>["samples"][keyof ReturnType<typeof buildSalesforceTaskAuditReport>["samples"]][number]
): string {
  return JSON.stringify({
    occurredAt: row.occurredAt,
    messageKind: row.messageKind,
    inferredShape: row.inferredShape,
    subject: row.subject,
    displayName: row.displayName,
    projects: row.projects,
    providerRecordId: row.providerRecordId,
    subjectEventCount: row.subjectEventCount,
    subjectContactCount: row.subjectContactCount,
    signals: row.signals,
    snippetPreview: formatSnippetPreview(row.snippet)
  });
}

function printHumanReadableReport(
  report: ReturnType<typeof buildSalesforceTaskAuditReport>
): void {
  console.log("audit-salesforce-task-ingest");
  console.log(`- total Salesforce outbound email rows: ${String(report.totalRows)}`);
  console.log(`- distinct contacts: ${String(report.distinctContacts)}`);
  console.log(`- rows without memberships: ${String(report.rowsWithoutMembership)}`);

  console.log("Message-kind counts:");
  for (const [messageKind, count] of Object.entries(report.messageKindCounts)) {
    console.log(`- ${messageKind}: ${String(count)}`);
  }

  console.log("Inferred-shape counts:");
  for (const [shape, count] of Object.entries(report.inferredShapeCounts)) {
    console.log(`- ${shape}: ${String(count)}`);
  }

  console.log("Signal counts:");
  for (const [signal, count] of Object.entries(report.signalCounts)) {
    console.log(`- ${signal}: ${String(count)}`);
  }

  if (Object.keys(report.mismatchCounts).length > 0) {
    console.log("Mismatch buckets:");
    for (const [label, count] of Object.entries(report.mismatchCounts)) {
      console.log(`- ${label}: ${String(count)}`);
    }
  }

  console.log("Top subjects:");
  for (const subject of report.topSubjects) {
    console.log(
      `- ${JSON.stringify({
        subject: subject.subject,
        eventCount: subject.eventCount,
        contactCount: subject.contactCount
      })}`
    );
  }

  const sections = [
    [
      "Sample rows: current auto + conversation signal",
      report.samples.autoWithConversationSignal
    ] as const,
    [
      "Sample rows: current auto + probable human conversation",
      report.samples.autoButProbablyHuman
    ] as const,
    [
      "Sample rows: current one_to_one + probable automation",
      report.samples.oneToOneButProbablyAutomation
    ] as const,
    [
      "Sample rows: probable human conversation",
      report.samples.probableHumanConversation
    ] as const,
    [
      "Sample rows: probable automation",
      report.samples.probableAutomation
    ] as const
  ];

  for (const [label, rows] of sections) {
    console.log(label);
    if (rows.length === 0) {
      console.log("- none");
      continue;
    }

    for (const row of rows) {
      console.log(`- ${buildSampleLine(row)}`);
    }
  }
}

async function main(): Promise<void> {
  const flags = parseCliFlags(process.argv.slice(2));
  const sampleLimit = readOptionalIntegerFlag(flags, "limit", 8);
  const topSubjectLimit = readOptionalIntegerFlag(flags, "subject-limit", 20);
  const asJson = readOptionalBooleanFlag(flags, "json", false);
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(process.env)
  });

  try {
    const rows = await loadSalesforceTaskAuditRows(connection.sql);
    const report = buildSalesforceTaskAuditReport(rows, {
      sampleLimit,
      topSubjectLimit
    });

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    printHumanReadableReport(report);
  } finally {
    await closeDatabaseConnection(connection);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
