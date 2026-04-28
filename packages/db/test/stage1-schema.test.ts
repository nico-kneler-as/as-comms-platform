import { describe, expect, it } from "vitest";

import { getTableName } from "drizzle-orm";
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
  sourceEvidenceLog
} from "../src/index.js";

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
});
