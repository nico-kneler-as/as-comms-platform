"use server";

import { sql } from "drizzle-orm";

import {
  salesforceAudienceListsSyncJobMaxAttempts,
  salesforceAudienceListsSyncJobName,
  salesforceAudienceListsSyncPayloadSchema,
} from "@as-comms/contracts";

import { requireAdmin } from "@/src/server/auth/session";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

/**
 * Future admin-only refresh controls call this; it intentionally has no UI in
 * this brick. The stable key coalesces repeated button presses into one sync.
 */
export async function enqueueSalesforceAudienceListsSync(): Promise<void> {
  await requireAdmin();
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    throw new Error("DATABASE_URL must be set before enqueueing Salesforce sync.");
  }

  const payload = salesforceAudienceListsSyncPayloadSchema.parse({ version: 1 });
  await runtime.connection.db.execute(sql`
    select graphile_worker.add_job(
      identifier => ${salesforceAudienceListsSyncJobName},
      payload => ${JSON.stringify(payload)}::json,
      job_key => 'salesforce-audience-lists-sync',
      job_key_mode => 'replace',
      max_attempts => ${salesforceAudienceListsSyncJobMaxAttempts}
    )
  `);
}
