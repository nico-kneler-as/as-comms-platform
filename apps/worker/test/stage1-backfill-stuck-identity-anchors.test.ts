import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "../../../packages/db/test/helpers.js";
import {
  buildContactProbeSoql,
  buildMembershipProbeSoql,
  classifyBucketedTargets,
  markIdentityCasesResolved,
  type StuckIdentityAnchorTarget,
} from "../src/ops/backfill-stuck-identity-anchors.js";

describe("backfill-stuck-identity-anchors helpers", () => {
  it("classifies probed contacts into buckets A, B, and C", () => {
    const targets: readonly StuckIdentityAnchorTarget[] = [
      {
        salesforceContactId: "003-bucket-a",
        stuckCount: 5,
        queueCaseIds: ["case-a"],
        sourceEvidenceIds: ["source-a"],
        oldestOpenedAt: "2026-04-30T00:00:00.000Z",
      },
      {
        salesforceContactId: "003-bucket-b",
        stuckCount: 4,
        queueCaseIds: ["case-b"],
        sourceEvidenceIds: ["source-b"],
        oldestOpenedAt: "2026-04-30T00:01:00.000Z",
      },
      {
        salesforceContactId: "003-bucket-c",
        stuckCount: 3,
        queueCaseIds: ["case-c"],
        sourceEvidenceIds: ["source-c"],
        oldestOpenedAt: "2026-04-30T00:02:00.000Z",
      },
    ];

    const classification = classifyBucketedTargets({
      targets,
      snapshotsBySalesforceContactId: new Map([
        [
          "003-bucket-a",
          {
            salesforceContactId: "003-bucket-a",
            hasMemberships: true,
            primaryEmail: "bucket-a@example.org",
            normalizedPhones: [],
            graphInput: {
              contact: {
                id: "contact:salesforce:003-bucket-a",
                salesforceContactId: "003-bucket-a",
                displayName: "Bucket A",
                primaryEmail: "bucket-a@example.org",
                primaryPhone: null,
                createdAt: "2026-04-30T00:00:00.000Z",
                updatedAt: "2026-04-30T00:00:00.000Z",
              },
              identities: [],
              memberships: [
                {
                  id: "membership-a",
                  contactId: "contact:salesforce:003-bucket-a",
                  projectId: "project-a",
                  expeditionId: "expedition-a",
                  salesforceMembershipId: "a0B-a",
                  role: null,
                  status: "Active",
                  source: "salesforce",
                  createdAt: "2026-04-30T00:00:00.000Z",
                },
              ],
              projectDimensions: [],
              expeditionDimensions: [],
            },
          },
        ],
        [
          "003-bucket-b",
          {
            salesforceContactId: "003-bucket-b",
            hasMemberships: false,
            primaryEmail: "bucket-b@example.org",
            normalizedPhones: [],
            graphInput: {
              contact: {
                id: "contact:salesforce:003-bucket-b",
                salesforceContactId: "003-bucket-b",
                displayName: "Bucket B",
                primaryEmail: "bucket-b@example.org",
                primaryPhone: null,
                createdAt: "2026-04-30T00:00:00.000Z",
                updatedAt: "2026-04-30T00:00:00.000Z",
              },
              identities: [],
              memberships: [],
              projectDimensions: [],
              expeditionDimensions: [],
            },
          },
        ],
      ]),
    });

    expect(classification.bucketA.map((entry) => entry.target.salesforceContactId)).toEqual([
      "003-bucket-a",
    ]);
    expect(classification.bucketB.map((entry) => entry.target.salesforceContactId)).toEqual([
      "003-bucket-b",
    ]);
    expect(classification.bucketC.map((entry) => entry.target.salesforceContactId)).toEqual([
      "003-bucket-c",
    ]);
  });

  it("builds the contact and membership SOQL probes", () => {
    expect(
      buildContactProbeSoql(["003AAA0000001", "003AAA0000002"]),
    ).toContain("SELECT Id, Email, Phone, MobilePhone, FirstName, LastName, Name, CreatedDate, LastModifiedDate, Volunteer_ID_Plain__c FROM Contact");
    expect(
      buildMembershipProbeSoql(["003AAA0000001"], {
        membershipObjectName: "Expedition_Members__c",
        membershipContactField: "Contact__c",
        membershipProjectField: "Project__c",
        membershipProjectNameField: "Project__r.Name",
        membershipExpeditionField: "Expedition__c",
        membershipExpeditionNameField: "Expedition__r.Name",
        membershipRoleField: null,
        membershipStatusField: "Status__c",
      }),
    ).toBe(
      "SELECT Id, Contact__c, Project__c, Project__r.Name, Expedition__c, Expedition__r.Name, Status__c FROM Expedition_Members__c WHERE Contact__c IN ('003AAA0000001') AND Project__c != null",
    );
  });

  it("terminally resolves open queue cases and appends the explanation", async () => {
    const context = await createTestStage1Context();

    try {
      await context.repositories.identityResolutionQueue.upsert({
        id: "identity-review:source-evidence:salesforce:task_communication:task-1:identity_missing_anchor",
        sourceEvidenceId: "source-evidence:salesforce:task_communication:task-1",
        candidateContactIds: [],
        reasonCode: "identity_missing_anchor",
        status: "open",
        openedAt: "2026-04-30T00:00:00.000Z",
        resolvedAt: null,
        normalizedIdentityValues: [],
        anchoredContactId: null,
        explanation: "Salesforce Contact ID 003AAA0000001 could not anchor.",
      });

      const resolvedCount = await markIdentityCasesResolved({
        repositories: context.repositories,
        caseIds: [
          "identity-review:source-evidence:salesforce:task_communication:task-1:identity_missing_anchor",
        ],
        resolvedAt: "2026-04-30T01:00:00.000Z",
        explanation:
          "Salesforce contact 003AAA0000001 not found in SF - terminally skipped",
      });

      const updatedCase = await context.repositories.identityResolutionQueue.findById(
        "identity-review:source-evidence:salesforce:task_communication:task-1:identity_missing_anchor",
      );

      expect(resolvedCount).toBe(1);
      expect(updatedCase?.status).toBe("resolved");
      expect(updatedCase?.resolvedAt).toBe("2026-04-30T01:00:00.000Z");
      expect(updatedCase?.explanation).toContain(
        "Salesforce contact 003AAA0000001 not found in SF - terminally skipped",
      );
    } finally {
      await context.dispose();
    }
  });
});
