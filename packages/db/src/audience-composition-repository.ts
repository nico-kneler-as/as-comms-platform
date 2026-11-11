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
  contacts,
  newsletterSubscribers,
  newsletterSuppressions,
  salesforceAudienceListMembers,
  salesforceAudienceLists,
} from "./schema/index.js";

type AudienceCompositionDatabase = PgDatabase<PgQueryResultHKT, DatabaseSchema>;
const INSERT_CHUNK_SIZE = 1_000;
const RECIPIENT_DELIVERY_STATUSES_TO_EXCLUDE: DeliveryStatus[] = [
  "pending",
  "failed",
  "suppressed_at_send",
];

export interface StandingListAudienceMember {
  readonly email: string;
  readonly newsletterSubscriberId: string | null;
  readonly firstName: string | null;
}

/**
 * Resolves a standing Salesforce list only when every selected list is an
 * insiders list. Campaign lists intentionally return null: they still narrow
 * the newsletter-subscriber base through normal audience composition.
 */
export async function resolveStandingListAudience(
  db: AudienceCompositionDatabase,
  listIds: readonly string[],
): Promise<readonly StandingListAudienceMember[] | null> {
  const ids = [...new Set(listIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return null;

  const lists = await db
    .select({
      id: salesforceAudienceLists.id,
      kind: salesforceAudienceLists.kind,
    })
    .from(salesforceAudienceLists)
    .where(inArray(salesforceAudienceLists.id, ids));
  if (
    lists.length !== ids.length ||
    lists.some((list) => list.kind !== "insiders")
  ) {
    return null;
  }

  const rows = await db
    .select({
      email: salesforceAudienceListMembers.normalizedEmail,
      subscriberId: newsletterSubscribers.id,
      subscriberStatus: newsletterSubscribers.status,
      subscriberFirstName: newsletterSubscribers.firstName,
      suppressionId: newsletterSuppressions.id,
      contactFirstName: contacts.displayName,
    })
    .from(salesforceAudienceListMembers)
    .leftJoin(
      newsletterSubscribers,
      eq(
        salesforceAudienceListMembers.normalizedEmail,
        newsletterSubscribers.email,
      ),
    )
    .leftJoin(
      newsletterSuppressions,
      eq(
        salesforceAudienceListMembers.normalizedEmail,
        newsletterSuppressions.email,
      ),
    )
    .leftJoin(
      contacts,
      eq(
        salesforceAudienceListMembers.salesforceContactId,
        contacts.salesforceContactId,
      ),
    )
    .where(inArray(salesforceAudienceListMembers.listId, ids))
    .orderBy(asc(salesforceAudienceListMembers.normalizedEmail));

  const byEmail = new Map<string, StandingListAudienceMember>();
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (email.length === 0 || byEmail.has(email)) continue;
    // A known newsletter subscriber who is no longer sendable is removed at
    // base resolution. A member with no subscriber row remains reachable.
    if (
      row.subscriberId !== null &&
      (row.subscriberStatus !== "subscribed" || row.suppressionId !== null)
    )
      continue;
    const contactFirstName =
      row.contactFirstName?.trim().split(/\s+/u)[0] ?? null;
    byEmail.set(email, {
      email,
      newsletterSubscriberId: row.subscriberId,
      firstName: row.subscriberFirstName ?? contactFirstName,
    });
  }
  return [...byEmail.values()];
}

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
