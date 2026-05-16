import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import type { Stage5RepositoryBundle } from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";

export const campaignEventsTailFinalizeJobName =
  "campaign-events-tail-finalize" as const;

export interface CampaignEventsTailFinalizeDependencies {
  readonly db: {
    execute(query: unknown): Promise<unknown>;
  };
  readonly campaigns: Stage5RepositoryBundle;
  readonly auditEvidence: Stage1RepositoryBundle["auditEvidence"];
  readonly logger?: Pick<Console, "info" | "warn" | "error">;
  readonly now?: () => Date;
}

interface FinalizeCandidateRow {
  readonly runId: string;
}

export async function runCampaignEventsTailFinalize(
  dependencies: CampaignEventsTailFinalizeDependencies,
): Promise<number> {
  const logger = dependencies.logger ?? console;
  const now = dependencies.now?.() ?? new Date();
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const result = await dependencies.db.execute(sql<FinalizeCandidateRow>`
    select id as "runId"
    from campaign_runs
    where state = 'complete'
      and completed_at is not null
      and completed_at < ${cutoff.toISOString()}::timestamptz
    order by completed_at asc, id asc
  `);
  const rows =
    (result as { readonly rows?: readonly FinalizeCandidateRow[] }).rows ?? [];

  for (const row of rows) {
    await dependencies.campaigns.campaignRuns.transitionState(
      row.runId,
      "complete",
      "finalized",
      {
        finalizedAt: now.toISOString(),
      },
    );
    await dependencies.auditEvidence.append({
      id: randomUUID(),
      actorType: "system",
      actorId: campaignEventsTailFinalizeJobName,
      action: "campaign_run.finalized",
      entityType: "campaign_run",
      entityId: row.runId,
      occurredAt: now.toISOString(),
      result: "recorded",
      policyCode: "stage5a.campaign_run.finalized",
      metadataJson: {
        detail: "Run finalized after the 30-day events tail.",
      },
    });
  }

  logger.info(
    JSON.stringify({
      event: "campaign.events_tail_finalize.completed",
      finalizedCount: rows.length,
      cutoff: cutoff.toISOString(),
    }),
  );

  return rows.length;
}
