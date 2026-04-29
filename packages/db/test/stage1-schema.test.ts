import { describe, expect, it } from "vitest";

import { getTableName, sql } from "drizzle-orm";
import {
  canonicalEventTypeValues,
  channelValues,
  providerValues,
  reviewStateValues,
  syncScopeValues
} from "@as-comms/contracts";

import {
  aiKnowledgeEntries,
  canonicalEventLedger,
  contactInboxProjection,
  contactTimelineProjection,
  databaseSchema,
  messageAttachments,
  projectKnowledgeEntries,
  sourceEvidenceLog,
  syncState
} from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";
import { mapSyncStateRow, mapSyncStateToInsert } from "../src/mappers.js";

describe("Stage 1 DB schema", () => {
  it("exports the Stage 1 and Stage 2 durable tables", () => {
    expect(Object.keys(databaseSchema).sort()).toEqual([
      // Auth.js v5 + Stage 2 Settings tables (see D-025)
      "accounts",
      "aiKnowledgeEntries",
      "auditPolicyEvidence",
      "canonicalEventLedger",
      "contactIdentities",
      "contactInboxProjection",
      "contactMemberships",
      "contactTimelineProjection",
      "contacts",
      "expeditionDimensions",
      "gmailMessageDetails",
      "identityResolutionQueue",
      "integrationHealth",
      "mailchimpCampaignActivityDetails",
      "manualNoteDetails",
      "messageAttachments",
      "pendingComposerOutbounds",
      "projectAliases",
      "projectDimensions",
      "projectKnowledgeEntries",
      "routingReviewQueue",
      "salesforceCommunicationDetails",
      "salesforceEventContext",
      "sessions",
      "simpleTextingMessageDetails",
      "sourceEvidenceLog",
      "syncState",
      "users",
      "verificationTokens"
    ]);
  });

  it("keeps canonical table names stable", () => {
    expect(getTableName(aiKnowledgeEntries)).toBe("ai_knowledge_entries");
    expect(getTableName(projectKnowledgeEntries)).toBe(
      "project_knowledge_entries"
    );
    expect(getTableName(messageAttachments)).toBe("message_attachments");
    expect(getTableName(sourceEvidenceLog)).toBe("source_evidence_log");
    expect(getTableName(canonicalEventLedger)).toBe("canonical_event_ledger");
    expect(getTableName(contactInboxProjection)).toBe(
      "contact_inbox_projection"
    );
    expect(getTableName(contactTimelineProjection)).toBe(
      "contact_timeline_projection"
    );
  });

  it("matches the Stage 1 enum surfaces from the shared contracts", () => {
    expect(providerValues).toContain("manual");
    expect(providerValues).toContain("salesforce");
    expect(channelValues).toEqual([
      "email",
      "sms",
      "lifecycle",
      "campaign_email",
      "note"
    ]);
    expect(canonicalEventTypeValues).toContain("campaign.email.unsubscribed");
    expect(canonicalEventTypeValues).toContain("note.internal.created");
    expect(reviewStateValues).toEqual([
      "clear",
      "needs_identity_review",
      "needs_routing_review",
      "quarantined"
    ]);
    expect(syncScopeValues).toEqual(["provider", "orchestration"]);
  });

  it("round-trips sync-state consecutive failure counts through the mapper", () => {
    const insert = mapSyncStateToInsert({
      id: "sync:salesforce:live:mapper",
      scope: "provider",
      provider: "salesforce",
      jobType: "live_ingest",
      cursor: "salesforce:cursor:mapper",
      windowStart: "2026-01-05T00:00:00.000Z",
      windowEnd: "2026-01-05T00:05:00.000Z",
      status: "failed",
      parityPercent: null,
      freshnessP95Seconds: null,
      freshnessP99Seconds: null,
      lastSuccessfulAt: null,
      consecutiveFailureCount: 4,
      leaseOwner: "worker:test",
      heartbeatAt: "2026-01-05T00:04:00.000Z",
      deadLetterCount: 1
    });
    const row = mapSyncStateRow({
      id: insert.id,
      scope: insert.scope,
      provider: insert.provider ?? null,
      jobType: insert.jobType,
      cursor: insert.cursor ?? null,
      windowStart: insert.windowStart ?? null,
      windowEnd: insert.windowEnd ?? null,
      status: insert.status,
      parityPercent: insert.parityPercent ?? null,
      freshnessP95Seconds: insert.freshnessP95Seconds ?? null,
      freshnessP99Seconds: insert.freshnessP99Seconds ?? null,
      lastSuccessfulAt: insert.lastSuccessfulAt ?? null,
      consecutiveFailureCount: insert.consecutiveFailureCount ?? 0,
      leaseOwner: insert.leaseOwner ?? null,
      heartbeatAt: insert.heartbeatAt ?? null,
      deadLetterCount: insert.deadLetterCount ?? 0,
      createdAt: new Date("2026-01-05T00:05:00.000Z"),
      updatedAt: new Date("2026-01-05T00:05:00.000Z")
    });

    expect(syncState.consecutiveFailureCount.name).toBe("consecutive_failure_count");
    expect(row.consecutiveFailureCount).toBe(4);
    expect(row.leaseOwner).toBe("worker:test");
    expect(row.heartbeatAt).toBe("2026-01-05T00:04:00.000Z");
    expect(row.deadLetterCount).toBe(1);
  });

  it("adds nullable lease and heartbeat columns to sync_state and preserves null round-trips", async () => {
    const context = await createTestStage1Context();

    try {
      const columnResult: unknown = await context.db.execute(sql<{
        readonly columnName: string;
        readonly dataType: string;
        readonly isNullable: "YES" | "NO";
      }>`
        select
          column_name as "columnName",
          data_type as "dataType",
          is_nullable as "isNullable"
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'sync_state'
          and column_name in ('lease_owner', 'heartbeat_at')
        order by column_name
      `);
      const columns = Array.isArray(columnResult)
        ? (columnResult as readonly {
            readonly columnName: string;
            readonly dataType: string;
            readonly isNullable: "YES" | "NO";
          }[])
        : (
            columnResult as {
              readonly rows: readonly {
                readonly columnName: string;
                readonly dataType: string;
                readonly isNullable: "YES" | "NO";
              }[];
            }
          ).rows;
      const inserted = await context.repositories.syncState.upsert({
        id: "sync:schema:lease-heartbeat",
        scope: "provider",
        provider: "gmail",
        jobType: "historical_backfill",
        cursor: null,
        windowStart: null,
        windowEnd: null,
        status: "running",
        parityPercent: null,
        freshnessP95Seconds: null,
        freshnessP99Seconds: null,
        lastSuccessfulAt: null,
        consecutiveFailureCount: 0,
        leaseOwner: null,
        heartbeatAt: null,
        deadLetterCount: 0
      });

      await expect(
        context.repositories.syncState.findById(inserted.id)
      ).resolves.toEqual(inserted);
      expect(columns).toEqual([
        {
          columnName: "heartbeat_at",
          dataType: "timestamp with time zone",
          isNullable: "YES"
        },
        {
          columnName: "lease_owner",
          dataType: "text",
          isNullable: "YES"
        }
      ]);
    } finally {
      await context.dispose();
    }
  });
});
