import { describe, expect, it } from "vitest";

import {
  buildSalesforceCommunicationDetailFromTaskRecord,
  parseSalesforceTaskPayloadRef,
  prepareSalesforceCommunicationDetailsFromCapturedRecords,
  type SalesforceCommunicationDetailBackfillCandidate
} from "../src/ops/backfill-salesforce-communication-details.js";

describe("backfill-salesforce-communication-details helpers", () => {
  it("derives Salesforce Flow detail rows from captured auto email tasks", () => {
    expect(
      buildSalesforceCommunicationDetailFromTaskRecord({
        recordType: "task_communication",
        recordId: "task-auto-1",
        channel: "email",
        messageKind: "auto",
        salesforceContactId: "003-stage1",
        occurredAt: "2026-01-01T00:04:00.000Z",
        receivedAt: "2026-01-01T00:05:00.000Z",
        payloadRef: "salesforce://Task/task-auto-1",
        checksum: "checksum-task-auto-1",
        subject: "Welcome Email",
        snippet: "Welcome to the project",
        normalizedEmails: ["volunteer@example.org"],
        normalizedPhones: [],
        volunteerIdPlainValues: [],
        supportingRecords: [],
        crossProviderCollapseKey: null,
        routing: {
          required: true,
          projectId: "project-1",
          expeditionId: "expedition-1",
          projectName: "Project One",
          expeditionName: "Expedition One"
        }
      })
    ).toEqual({
      sourceEvidenceId: "source-evidence:salesforce:task_communication:task-auto-1",
      providerRecordId: "task-auto-1",
      channel: "email",
      messageKind: "auto",
      subject: "Welcome Email",
      snippet: "Welcome to the project",
      sourceLabel: "Salesforce Flow"
    });
  });

  it("matches refetched Task rows back to missing-detail candidates and reports misses", () => {
    const candidates: readonly SalesforceCommunicationDetailBackfillCandidate[] = [
      {
        sourceEvidenceId: "source-evidence:salesforce:task_communication:task-auto-1",
        providerRecordId: "task-auto-1",
        payloadRef: "salesforce://Task/task-auto-1",
        contactId: "contact:salesforce:003-stage1"
      },
      {
        sourceEvidenceId: "source-evidence:salesforce:task_communication:task-auto-2",
        providerRecordId: "task-auto-2",
        payloadRef: "salesforce://Task/task-auto-2",
        contactId: "contact:salesforce:003-stage2"
      }
    ];

    const prepared = prepareSalesforceCommunicationDetailsFromCapturedRecords({
      candidates,
      capturedRecords: [
        {
          recordType: "task_communication",
          recordId: "task-auto-1",
          channel: "email",
          messageKind: "auto",
          salesforceContactId: "003-stage1",
          occurredAt: "2026-01-01T00:04:00.000Z",
          receivedAt: "2026-01-01T00:05:00.000Z",
          payloadRef: "salesforce://Task/task-auto-1",
          checksum: "checksum-task-auto-1",
          subject: "Welcome Email",
          snippet: "Welcome to the project",
          normalizedEmails: ["volunteer@example.org"],
          normalizedPhones: [],
          volunteerIdPlainValues: [],
          supportingRecords: [],
          crossProviderCollapseKey: null,
          routing: {
            required: false,
            projectId: null,
            expeditionId: null,
            projectName: null,
            expeditionName: null
          }
        },
        {
          recordType: "contact_snapshot",
          recordId: "003-stage1",
          salesforceContactId: "003-stage1",
          displayName: "Stage One Volunteer",
          primaryEmail: "volunteer@example.org",
          primaryPhone: null,
          normalizedEmails: ["volunteer@example.org"],
          normalizedPhones: [],
          volunteerIdPlainValues: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:05:00.000Z",
          memberships: []
        }
      ]
    });

    expect(prepared.prepared).toEqual([
      {
        sourceEvidenceId:
          "source-evidence:salesforce:task_communication:task-auto-1",
        providerRecordId: "task-auto-1",
        contactId: "contact:salesforce:003-stage1",
        detail: {
          sourceEvidenceId:
            "source-evidence:salesforce:task_communication:task-auto-1",
          providerRecordId: "task-auto-1",
          channel: "email",
          messageKind: "auto",
          subject: "Welcome Email",
          snippet: "Welcome to the project",
          sourceLabel: "Salesforce Flow"
        }
      }
    ]);
    expect(prepared.missing).toEqual([
      {
        sourceEvidenceId:
          "source-evidence:salesforce:task_communication:task-auto-2",
        providerRecordId: "task-auto-2",
        payloadRef: "salesforce://Task/task-auto-2",
        contactId: "contact:salesforce:003-stage2"
      }
    ]);
  });

  it("parses Salesforce Task payload refs and rejects other object types", () => {
    expect(
      parseSalesforceTaskPayloadRef("salesforce://Task/00T%2Ftask-1")
    ).toEqual({
      objectName: "Task",
      recordId: "00T/task-1"
    });

    expect(() =>
      parseSalesforceTaskPayloadRef("salesforce://Contact/003-stage1")
    ).toThrow(/Task object/);
  });
});
