#!/usr/bin/env tsx
import process from "node:process";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  type PostgresClient
} from "@as-comms/db";

import {
  buildUnmappedTaskScopeReport,
  renderUnmappedTaskScopeMarkdown,
  type UnmappedTaskScopeAuditRow
} from "../../apps/worker/src/ops/diag-unmapped-task-scope.js";

interface UnmappedTaskScopeAuditRowRaw {
  readonly policy_code: string;
  readonly entity_id: string;
  readonly occurred_at: string;
  readonly task_subtype: string | null;
  readonly subject: string | null;
  readonly owner_username: string | null;
  readonly who_id: string | null;
  readonly related_membership_present: boolean | null;
  readonly created_date: string | null;
  readonly last_modified_date: string | null;
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

async function loadRows(sql: PostgresClient): Promise<readonly UnmappedTaskScopeAuditRow[]> {
  const rows = await sql.unsafe<readonly UnmappedTaskScopeAuditRowRaw[]>(`
    select
      policy_code,
      entity_id,
      occurred_at::text as occurred_at,
      metadata_json ->> 'taskSubtype' as task_subtype,
      metadata_json ->> 'subject' as subject,
      metadata_json ->> 'ownerUsername' as owner_username,
      metadata_json ->> 'whoId' as who_id,
      case
        when metadata_json ? 'relatedMembershipPresent'
          then coalesce((metadata_json ->> 'relatedMembershipPresent')::boolean, false)
        else false
      end as related_membership_present,
      metadata_json ->> 'createdDate' as created_date,
      metadata_json ->> 'lastModifiedDate' as last_modified_date
    from audit_policy_evidence
    where policy_code like 'stage1.skip.task_unmapped%'
    order by occurred_at desc, entity_id desc
  `);

  return rows.map((row) => ({
    policyCode: row.policy_code,
    entityId: row.entity_id,
    occurredAt: row.occurred_at,
    taskSubtype: row.task_subtype,
    subject: row.subject,
    ownerUsername: row.owner_username,
    whoId: row.who_id,
    relatedMembershipPresent: row.related_membership_present ?? false,
    createdDate: row.created_date,
    lastModifiedDate: row.last_modified_date
  }));
}

async function main(): Promise<void> {
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(process.env)
  });

  try {
    const rows = await loadRows(connection.sql as PostgresClient);
    const report = buildUnmappedTaskScopeReport({ rows });
    process.stdout.write(renderUnmappedTaskScopeMarkdown(report));
  } finally {
    await closeDatabaseConnection(connection);
  }
}

await main();
