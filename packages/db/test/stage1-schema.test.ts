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
  canonicalEventLedger,
  contactInboxProjection,
  contactTimelineProjection,
  databaseSchema,
  sourceEvidenceLog
} from "../src/index.js";

describe("Stage 1 DB schema", () => {
  it("exports the Stage 1 durable tables", () => {
    expect(Object.keys(databaseSchema).sort()).toEqual([
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
      "projectDimensions",
      "routingReviewQueue",
      "salesforceEventContext",
      "sourceEvidenceLog",
      "syncState"
    ]);
  });

  it("keeps canonical table names stable", () => {
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
    expect(providerValues).toContain("salesforce");
    expect(channelValues).toEqual([
      "email",
      "sms",
      "lifecycle",
      "campaign_email"
    ]);
    expect(canonicalEventTypeValues).toContain("campaign.email.unsubscribed");
    expect(reviewStateValues).toEqual([
      "clear",
      "needs_identity_review",
      "needs_routing_review",
      "quarantined"
    ]);
    expect(syncScopeValues).toEqual(["provider", "orchestration"]);
  });
});
