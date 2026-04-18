import { describe, expect, it } from "vitest";

import {
  buildProjectionRebuildRequestsForContacts,
  planSalesforceTaskReclassifications,
  type SalesforceTaskReclassificationCandidate
} from "../src/ops/reclassify-salesforce-tasks.js";

describe("reclassify-salesforce-tasks planning", () => {
  it("reclassifies only one_to_one Salesforce outbound emails that resolve to auto", () => {
    const candidates: SalesforceTaskReclassificationCandidate[] = [
      {
        canonicalEventId: "evt:subject-pattern",
        contactId: "contact:1",
        sourceEvidenceId: "sev:subject-pattern",
        currentMessageKind: "one_to_one",
        subject: "Training reminder",
        snippet: "Training reminder body"
      },
      {
        canonicalEventId: "evt:ambiguous",
        contactId: "contact:2",
        sourceEvidenceId: "sev:ambiguous",
        currentMessageKind: "one_to_one",
        subject: "Manual follow-up",
        snippet: "Manual follow-up body"
      },
      {
        canonicalEventId: "evt:already-auto",
        contactId: "contact:2",
        sourceEvidenceId: "sev:already-auto",
        currentMessageKind: "auto",
        subject: "Training reminder",
        snippet: "Already auto"
      }
    ];

    const plan = planSalesforceTaskReclassifications(candidates);

    expect(plan.scannedCount).toBe(3);
    expect(plan.reclassifiedCount).toBe(2);
    expect(plan.affectedContactIds).toEqual(["contact:1", "contact:2"]);
    expect(plan.reasonCounts).toEqual({
      insufficient_metadata: 1,
      subject_pattern: 1
    });
    expect(plan.changes).toEqual([
      expect.objectContaining({
        canonicalEventId: "evt:subject-pattern",
        nextMessageKind: "auto",
        summary: "Auto email sent",
        sourceLabel: "Salesforce Flow",
        reason: "subject_pattern"
      }),
      expect.objectContaining({
        canonicalEventId: "evt:ambiguous",
        nextMessageKind: "auto",
        reason: "insufficient_metadata"
      })
    ]);
  });

  it("builds scoped stage1.projection.rebuild jobs using all projections", () => {
    let idCounter = 0;
    const requests = buildProjectionRebuildRequestsForContacts(
      ["contact:b", "contact:a", "contact:a"],
      {
        buildId: (prefix) => `${prefix}:${String(++idCounter)}`
      }
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      jobName: "stage1.projection.rebuild",
      payload: expect.objectContaining({
        jobType: "projection_rebuild",
        projection: "all",
        contactIds: ["contact:a", "contact:b"],
        includeReviewOverlayRefresh: true
      })
    });
  });
});
