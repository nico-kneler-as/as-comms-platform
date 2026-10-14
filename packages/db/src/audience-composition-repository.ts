import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { DatabaseSchema } from "./schema/index.js";
import type { CampaignRunRecord, DeliveryStatus } from "@as-comms/contracts";
import {
  audienceSnapshots,
  broadcastLinkClicks,
  broadcastOpens,
  broadcastUploadedExclusions,
  salesforceAudienceListMembers,
} from "./schema/index.js";

type AudienceCompositionDatabase = PgDatabase<PgQueryResultHKT, DatabaseSchema>;
const INSERT_CHUNK_SIZE = 1_000;
const RECIPIENT_DELIVERY_STATUSES_TO_EXCLUDE: DeliveryStatus[] = [
  "pending",
  "failed",
  "suppressed_at_send",
];

export async function upsertBroadcastUploadedExclusionsForRun(
  db: AudienceCompositionDatabase,
  runId: string,
  normalizedEmails: readonly string[],
): Promise<number> {
  const emails = [...new Set(normalizedEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  let inserted = 0;
  for (let index = 0; index < emails.length; index += INSERT_CHUNK_SIZE) {
    const rows = await db.insert(broadcastUploadedExclusions).values(
      emails.slice(index, index + INSERT_CHUNK_SIZE).map((normalizedEmail) => ({
        id: randomUUID(), campaignRunId: runId, normalizedEmail,
      })),
    ).onConflictDoNothing().returning({ id: broadcastUploadedExclusions.id });
    inserted += rows.length;
  }
  return inserted;
}

export async function clearBroadcastUploadedExclusionsForRun(
  db: AudienceCompositionDatabase,
  runId: string,
): Promise<void> {
  await db.delete(broadcastUploadedExclusions).where(eq(broadcastUploadedExclusions.campaignRunId, runId));
}

export async function listBroadcastUploadedExclusionsForRun(
  db: AudienceCompositionDatabase,
  runId: string,
): Promise<readonly string[]> {
  const rows = await db.select({ normalizedEmail: broadcastUploadedExclusions.normalizedEmail })
    .from(broadcastUploadedExclusions)
    .where(eq(broadcastUploadedExclusions.campaignRunId, runId))
    .orderBy(asc(broadcastUploadedExclusions.normalizedEmail));
  return rows.map((row) => row.normalizedEmail);
}

export async function emailsForPreviousRunAudience(
  db: AudienceCompositionDatabase,
  runId: string,
  audience: "recipients" | "openers" | "clickers",
): Promise<readonly string[]> {
  if (audience === "recipients") {
    const rows = await db.selectDistinct({ email: audienceSnapshots.frozenEmail })
      .from(audienceSnapshots)
      .where(and(
        eq(audienceSnapshots.campaignRunId, runId),
        notInArray(audienceSnapshots.deliveryStatus, RECIPIENT_DELIVERY_STATUSES_TO_EXCLUDE),
      ));
    return rows.map((row) => row.email.trim().toLowerCase());
  }
  const activity = audience === "openers" ? broadcastOpens : broadcastLinkClicks;
  const rows = await db.selectDistinct({ email: audienceSnapshots.frozenEmail })
    .from(activity)
    .innerJoin(audienceSnapshots, eq(activity.audienceSnapshotId, audienceSnapshots.id))
    .where(eq(activity.campaignRunId, runId));
  return rows.map((row) => row.email.trim().toLowerCase());
}

async function emailsForSalesforceLists(
  db: AudienceCompositionDatabase,
  listIds: readonly string[],
): Promise<readonly string[]> {
  const ids = [...new Set(listIds.map((id) => id.trim()).filter(Boolean))];
  const emails = new Set<string>();
  for (let index = 0; index < ids.length; index += INSERT_CHUNK_SIZE) {
    const rows = await db.select({ email: salesforceAudienceListMembers.normalizedEmail })
      .from(salesforceAudienceListMembers)
      .where(inArray(salesforceAudienceListMembers.listId, ids.slice(index, index + INSERT_CHUNK_SIZE)));
    for (const row of rows) emails.add(row.email.trim().toLowerCase());
  }
  return [...emails];
}

export async function loadAudienceSetsForRun(
  db: AudienceCompositionDatabase,
  run: CampaignRunRecord,
): Promise<{
  readonly includeEmails: ReadonlySet<string> | null;
  readonly exclusions: readonly { readonly reason: string; readonly emails: ReadonlySet<string> }[];
}> {
  const criteria = run.audienceCriteria;
  const includeEmails = criteria.initialFilter === "salesforce_lists"
    ? new Set(await emailsForSalesforceLists(db, criteria.salesforceListIds ?? []))
    : null;
  const exclusions: { reason: string; emails: ReadonlySet<string> }[] = [];
  const configuredExclusions = criteria.exclusions ?? {
    salesforceListIds: [], useUploadedExclusions: false, previousRuns: [],
  };
  for (const listId of configuredExclusions.salesforceListIds) {
    exclusions.push({
      reason: `salesforce_list:${listId}`,
      emails: new Set(await emailsForSalesforceLists(db, [listId])),
    });
  }
  if (configuredExclusions.useUploadedExclusions) {
    exclusions.push({
      reason: "uploaded_exclusions",
      emails: new Set(await listBroadcastUploadedExclusionsForRun(db, run.id)),
    });
  }
  for (const previous of configuredExclusions.previousRuns) {
    exclusions.push({
      reason: `previous_run:${previous.runId}:${previous.audience}`,
      emails: new Set(await emailsForPreviousRunAudience(db, previous.runId, previous.audience)),
    });
  }
  return { includeEmails, exclusions };
}
