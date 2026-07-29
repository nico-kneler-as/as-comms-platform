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
  audienceSnapshots,
  broadcastLinkClicks,
  broadcastOpens,
  broadcastUploadedRecipients,
  canonicalEventAudience,
  canonicalEventLedger,
  campaignRuns,
  composerDrafts,
  contactInboxProjection,
  contactConsent,
  contactTimelineProjection,
  databaseSchema,
  dependencyAuditSummary,
  internalNotes,
  messageAttachments,
  newsletterSubscribers,
  newsletterSuppressions,
  opsAlertState,
  opsDigestWatermark,
  orgSenders,
  orgSettings,
  projectKnowledgeEntries,
  suppressionList,
  sourceEvidenceLog,
  sourceEvidenceQuarantine,
  syncState
} from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";
import { mapSyncStateRow, mapSyncStateToInsert } from "../src/mappers.js";

describe("Stage 1 DB schema", () => {
  it("exports the Stage 1, Stage 2, and Stage 5 durable tables", () => {
    expect(Object.keys(databaseSchema).sort()).toEqual([
      // Auth.js v5 + Stage 2 Settings tables (see D-025)
      "accounts",
      "aiKnowledgeEntries",
      "audienceSnapshots",
      "auditPolicyEvidence",
      "broadcastLinkClicks",
      "broadcastMediaAssets",
      "broadcastOpens",
      "broadcastUploadedRecipients",
      "campaignRuns",
      "canonicalEventAudience",
      "canonicalEventLedger",
      "composerDrafts",
      "consentRecords",
      "contactConsent",
      "contactIdentities",
      "contactInboxProjection",
      "contactMemberships",
      "contactTimelineProjection",
      "contacts",
      "dependencyAuditSummary",
      "expeditionDimensions",
      "gmailMessageDetails",
      "identityResolutionQueue",
      "integrationBackfillJobs",
      "integrationHealth",
      "internalNotes",
      "mailchimpCampaignActivityDetails",
      "mailchimpCampaignTailState",
      "manualNoteDetails",
      // MCP connector OAuth authorization server (PRD #677 Brick 2)
      "mcpOAuthAuthorizationCodes",
      "mcpOAuthClients",
      "mcpOAuthTokens",
      "messageAttachments",
      "newsletterSubscribers",
      "newsletterSuppressions",
      "opsAlertState",
      "opsDigestWatermark",
      "orgSenders",
      "orgSettings",
      "pendingComposerOutbounds",
      "postmarkWebhookDeadLetter",
      "projectAliases",
      "projectDimensions",
      "projectKnowledgeEntries",
      "routingReviewQueue",
      "salesforceCommunicationDetails",
      "salesforceEventContext",
      "sessions",
      "simpleTextingMessageDetails",
      "smsMessages",
      "smsSenders",
      "sourceEvidenceLog",
      "sourceEvidenceQuarantine",
      "suppressionList",
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
    expect(getTableName(newsletterSubscribers)).toBe("newsletter_subscribers");
    expect(getTableName(newsletterSuppressions)).toBe(
      "newsletter_suppressions"
    );
    expect(getTableName(opsAlertState)).toBe("ops_alert_state");
    expect(getTableName(opsDigestWatermark)).toBe("ops_digest_watermark");
    expect(getTableName(dependencyAuditSummary)).toBe(
      "dependency_audit_summary"
    );
    expect(getTableName(orgSenders)).toBe("org_senders");
    expect(getTableName(sourceEvidenceLog)).toBe("source_evidence_log");
    expect(getTableName(sourceEvidenceQuarantine)).toBe(
      "source_evidence_quarantine"
    );
    expect(getTableName(campaignRuns)).toBe("campaign_runs");
    expect(getTableName(composerDrafts)).toBe("composer_drafts");
    expect(getTableName(audienceSnapshots)).toBe("audience_snapshots");
    expect(getTableName(broadcastLinkClicks)).toBe("broadcast_link_clicks");
    expect(getTableName(broadcastOpens)).toBe("broadcast_opens");
    expect(getTableName(broadcastUploadedRecipients)).toBe(
      "broadcast_uploaded_recipients"
    );
    expect(getTableName(contactConsent)).toBe("contact_consent");
    expect(getTableName(suppressionList)).toBe("suppression_list");
    expect(getTableName(orgSettings)).toBe("org_settings");
    expect(getTableName(canonicalEventLedger)).toBe("canonical_event_ledger");
    expect(getTableName(canonicalEventAudience)).toBe(
      "canonical_event_audience"
    );
    expect(getTableName(internalNotes)).toBe("internal_notes");
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
    expect(canonicalEventTypeValues).toContain("campaign.email.delivered");
    expect(canonicalEventTypeValues).toContain("campaign.email.bounced");
    expect(canonicalEventTypeValues).toContain("campaign.email.complained");
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

  it("adds bot-classification columns and the broadcast_opens table", async () => {
    const context = await createTestStage1Context();

    try {
      const columnResult: unknown = await context.db.execute(sql<{
        readonly tableName: string;
        readonly columnName: string;
        readonly dataType: string;
        readonly isNullable: "YES" | "NO";
      }>`
        select
          table_name as "tableName",
          column_name as "columnName",
          data_type as "dataType",
          is_nullable as "isNullable"
        from information_schema.columns
        where table_schema = 'public'
          and (
            (table_name = 'broadcast_link_clicks' and column_name in ('is_bot', 'bot_reason'))
            or (
              table_name = 'broadcast_opens'
              and column_name in (
                'opened_at',
                'is_bot',
                'bot_reason',
                'idempotency_key'
              )
            )
          )
        order by table_name, column_name
      `);
      const columns = Array.isArray(columnResult)
        ? (columnResult as readonly {
            readonly tableName: string;
            readonly columnName: string;
            readonly dataType: string;
            readonly isNullable: "YES" | "NO";
          }[])
        : (
            columnResult as {
              readonly rows: readonly {
                readonly tableName: string;
                readonly columnName: string;
                readonly dataType: string;
                readonly isNullable: "YES" | "NO";
              }[];
            }
          ).rows;

      expect(columns).toEqual([
        {
          tableName: "broadcast_link_clicks",
          columnName: "bot_reason",
          dataType: "text",
          isNullable: "YES",
        },
        {
          tableName: "broadcast_link_clicks",
          columnName: "is_bot",
          dataType: "boolean",
          isNullable: "NO",
        },
        {
          tableName: "broadcast_opens",
          columnName: "bot_reason",
          dataType: "text",
          isNullable: "YES",
        },
        {
          tableName: "broadcast_opens",
          columnName: "idempotency_key",
          dataType: "text",
          isNullable: "NO",
        },
        {
          tableName: "broadcast_opens",
          columnName: "is_bot",
          dataType: "boolean",
          isNullable: "NO",
        },
        {
          tableName: "broadcast_opens",
          columnName: "opened_at",
          dataType: "timestamp with time zone",
          isNullable: "NO",
        },
      ]);
    } finally {
      await context.dispose();
    }
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
