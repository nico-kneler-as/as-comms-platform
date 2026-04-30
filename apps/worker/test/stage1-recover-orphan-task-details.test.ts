import { describe, expect, it } from "vitest";

import { createTestStage1Context } from "../../../packages/db/test/helpers.js";
import {
  applyTaskRecoveryPlans,
  buildRecoveredDetailForCase,
  groupCasesBySalesforceTaskId,
  planTaskRecoveryCases,
  type OrphanTaskCaseTarget,
} from "../src/ops/recover-orphan-task-details.js";

function getOnly<TValue>(values: readonly TValue[]): TValue {
  expect(values).toHaveLength(1);
  const value = values[0];

  if (value === undefined) {
    throw new Error("Expected exactly one value.");
  }

  return value;
}

describe("recover-orphan-task-details helpers", () => {
  it("classifies recoverable, missing, and unmapped task cases", () => {
    const grouped = groupCasesBySalesforceTaskId([
      {
        queueCaseId: "case-r",
        sourceEvidenceId: "source-evidence:salesforce:task_communication:task-r",
        salesforceTaskId: "task-r",
        occurredAt: "2026-04-30T00:00:00.000Z",
        receivedAt: "2026-04-30T00:00:01.000Z",
        salesforceContactId: "003-r",
        projectId: "project-r",
        expeditionId: null,
        sourceField: null,
      },
      {
        queueCaseId: "case-m",
        sourceEvidenceId: "source-evidence:salesforce:task_communication:task-m",
        salesforceTaskId: "task-m",
        occurredAt: "2026-04-30T00:01:00.000Z",
        receivedAt: "2026-04-30T00:01:01.000Z",
        salesforceContactId: "003-m",
        projectId: "project-m",
        expeditionId: null,
        sourceField: null,
      },
      {
        queueCaseId: "case-u",
        sourceEvidenceId: "source-evidence:salesforce:task_communication:task-u",
        salesforceTaskId: "task-u",
        occurredAt: "2026-04-30T00:02:00.000Z",
        receivedAt: "2026-04-30T00:02:01.000Z",
        salesforceContactId: null,
        projectId: null,
        expeditionId: null,
        sourceField: null,
      },
    ]);
    const salesforceConfig = {
      bearerToken: "token",
      loginUrl: "https://example.my.salesforce.com",
      clientId: "client",
      username: "user@example.org",
      jwtPrivateKey: "private-key",
      jwtExpirationSeconds: 180,
      apiVersion: "61.0",
      contactCaptureMode: "delta_polling" as const,
      membershipCaptureMode: "delta_polling" as const,
      membershipObjectName: "Expedition_Members__c",
      membershipContactField: "Contact__c",
      membershipProjectField: "Project__c",
      membershipProjectNameField: "Project__r.Name",
      membershipExpeditionField: "Expedition__c",
      membershipExpeditionNameField: "Expedition__r.Name",
      membershipRoleField: null,
      membershipStatusField: "Status__c",
      taskContactField: "WhoId",
      taskChannelField: "TaskSubtype",
      taskEmailChannelValues: ["Email"],
      taskSmsChannelValues: ["SMS", "Text"],
      taskSnippetField: "Description",
      taskOccurredAtField: "CreatedDate",
      taskCrossProviderKeyField: null,
      timeoutMs: 15_000,
    };

    const recoverableTarget = getOnly(grouped.filter((entry) => entry.salesforceTaskId === "task-r"));
    const missingTarget = getOnly(grouped.filter((entry) => entry.salesforceTaskId === "task-m"));
    const unmappedTarget = getOnly(grouped.filter((entry) => entry.salesforceTaskId === "task-u"));

    expect(
      getOnly(
        planTaskRecoveryCases({
          taskTarget: recoverableTarget,
          salesforceTask: {
            Id: "task-r",
            TaskSubtype: "Email",
            Subject: "Checking in",
            Description: "Checking in",
            CreatedDate: "2026-04-30T13:40:34.000+0000",
            OwnerId: "005-human",
            "Owner.Name": "Volunteer Coordinator",
            "Owner.Username": "coordinator@example.org",
            WhoId: "003-r",
          },
          salesforceConfig,
        }),
      ),
    ).toMatchObject({
      bucket: "R",
      detail: {
        messageKind: "one_to_one",
        sourceLabel: "Salesforce Task",
      },
    });
    const missingPlan = getOnly(
      planTaskRecoveryCases({
        taskTarget: missingTarget,
        salesforceTask: null,
        salesforceConfig,
      }),
    );
    expect(missingPlan.bucket).toBe("M");
    expect(missingPlan.explanation).toContain("no longer exists in SF");

    const unmappedPlan = getOnly(
      planTaskRecoveryCases({
        taskTarget: unmappedTarget,
        salesforceTask: {
          Id: "task-u",
          TaskSubtype: "Task",
          Subject: "General follow-up",
          Description: "General follow-up",
          CreatedDate: "2026-04-30T13:40:34.000+0000",
          OwnerId: "005-human",
          "Owner.Name": "Volunteer Coordinator",
          "Owner.Username": "coordinator@example.org",
          WhoId: "003-u",
        },
        salesforceConfig,
      }),
    );
    expect(unmappedPlan.bucket).toBe("U");
    expect(unmappedPlan.explanation).toContain(
      "pending Phase 2 classifier fix",
    );
  });

  it("wires channel and message-kind helpers into recovered detail rows", () => {
    const taskCase: OrphanTaskCaseTarget = {
      queueCaseId: "case-auto",
      sourceEvidenceId:
        "source-evidence:salesforce:task_communication:task-auto",
      salesforceTaskId: "task-auto",
      occurredAt: "2026-04-30T00:00:00.000Z",
      receivedAt: "2026-04-30T00:00:01.000Z",
      salesforceContactId: "003-auto",
      projectId: "project-auto",
      expeditionId: null,
      sourceField: null,
    };

    expect(
      buildRecoveredDetailForCase({
        taskCase,
        salesforceTask: {
          Id: "task-auto",
          TaskSubtype: "Email",
          Subject: "Welcome Email",
          Description: "Welcome to the project",
          CreatedDate: "2026-04-30T13:40:34.000+0000",
          OwnerId: "005-auto",
          "Owner.Name": "Nim Admin",
          "Owner.Username": "admin+1@adventurescientists.org",
          WhoId: "003-auto",
        },
        salesforceConfig: {
          bearerToken: "token",
          loginUrl: "https://example.my.salesforce.com",
          clientId: "client",
          username: "user@example.org",
          jwtPrivateKey: "private-key",
          jwtExpirationSeconds: 180,
          apiVersion: "61.0",
          contactCaptureMode: "delta_polling",
          membershipCaptureMode: "delta_polling",
          membershipObjectName: "Expedition_Members__c",
          membershipContactField: "Contact__c",
          membershipProjectField: "Project__c",
          membershipProjectNameField: "Project__r.Name",
          membershipExpeditionField: "Expedition__c",
          membershipExpeditionNameField: "Expedition__r.Name",
          membershipRoleField: null,
          membershipStatusField: "Status__c",
          taskContactField: "WhoId",
          taskChannelField: "TaskSubtype",
          taskEmailChannelValues: ["Email"],
          taskSmsChannelValues: ["SMS", "Text"],
          taskSnippetField: "Description",
          taskOccurredAtField: "CreatedDate",
          taskCrossProviderKeyField: null,
          timeoutMs: 15_000,
        },
      }),
    ).toEqual({
      sourceEvidenceId:
        "source-evidence:salesforce:task_communication:task-auto",
      providerRecordId: "task-auto",
      channel: "email",
      messageKind: "auto",
      subject: "Welcome Email",
      snippet: "Welcome to the project",
      sourceLabel: "Salesforce Flow",
    });
  });

  it("terminal-skips missing tasks through the queue resolution path", async () => {
    const context = await createTestStage1Context();

    try {
      await context.repositories.sourceEvidence.append({
        id: "source-evidence:salesforce:task_communication:task-missing",
        provider: "salesforce",
        providerRecordType: "task_communication",
        providerRecordId: "task-missing",
        receivedAt: "2026-04-30T00:00:00.000Z",
        occurredAt: "2026-04-30T00:00:00.000Z",
        payloadRef: "salesforce://Task/task-missing",
        idempotencyKey:
          "source-evidence:salesforce:task_communication:task-missing",
        checksum: "checksum:task-missing",
      });
      await context.repositories.identityResolutionQueue.upsert({
        id: "identity-review:source-evidence:salesforce:task_communication:task-missing:identity_missing_anchor",
        sourceEvidenceId:
          "source-evidence:salesforce:task_communication:task-missing",
        candidateContactIds: [],
        reasonCode: "identity_missing_anchor",
        status: "open",
        openedAt: "2026-04-30T00:00:00.000Z",
        resolvedAt: null,
        normalizedIdentityValues: [],
        anchoredContactId: null,
        explanation: "Salesforce Contact ID 003MISSING could not anchor.",
      });

      const grouped = groupCasesBySalesforceTaskId([
        {
          queueCaseId:
            "identity-review:source-evidence:salesforce:task_communication:task-missing:identity_missing_anchor",
          sourceEvidenceId:
            "source-evidence:salesforce:task_communication:task-missing",
          salesforceTaskId: "task-missing",
          occurredAt: "2026-04-30T00:00:00.000Z",
          receivedAt: "2026-04-30T00:00:00.000Z",
          salesforceContactId: "003MISSING",
          projectId: null,
          expeditionId: null,
          sourceField: null,
        },
      ]);
      const taskTarget = getOnly(grouped);
      const plans = planTaskRecoveryCases({
        taskTarget,
        salesforceTask: null,
        salesforceConfig: {
          bearerToken: "token",
          loginUrl: "https://example.my.salesforce.com",
          clientId: "client",
          username: "user@example.org",
          jwtPrivateKey: "private-key",
          jwtExpirationSeconds: 180,
          apiVersion: "61.0",
          contactCaptureMode: "delta_polling",
          membershipCaptureMode: "delta_polling",
          membershipObjectName: "Expedition_Members__c",
          membershipContactField: "Contact__c",
          membershipProjectField: "Project__c",
          membershipProjectNameField: "Project__r.Name",
          membershipExpeditionField: "Expedition__c",
          membershipExpeditionNameField: "Expedition__r.Name",
          membershipRoleField: null,
          membershipStatusField: "Status__c",
          taskContactField: "WhoId",
          taskChannelField: "TaskSubtype",
          taskEmailChannelValues: ["Email"],
          taskSmsChannelValues: ["SMS", "Text"],
          taskSnippetField: "Description",
          taskOccurredAtField: "CreatedDate",
          taskCrossProviderKeyField: null,
          timeoutMs: 15_000,
        },
      });

      const result = await applyTaskRecoveryPlans({
        db: context.db,
        taskTarget,
        plans,
        dryRun: false,
      });
      const updatedCase = await context.repositories.identityResolutionQueue.findById(
        "identity-review:source-evidence:salesforce:task_communication:task-missing:identity_missing_anchor",
      );

      expect(result).toEqual({
        recoveredCount: 0,
        missingTerminalSkipped: 1,
        unmappedTerminalSkipped: 0,
      });
      expect(updatedCase?.status).toBe("resolved");
      expect(updatedCase?.explanation).toContain(
        "Salesforce Task task-missing no longer exists in SF",
      );
    } finally {
      await context.dispose();
    }
  });
});
