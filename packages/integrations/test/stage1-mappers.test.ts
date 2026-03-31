import { describe, expect, it } from "vitest";

import {
  mapGmailRecord,
  mapMailchimpRecord,
  mapSalesforceRecord,
  mapSimpleTextingRecord
} from "../src/index.js";

describe("Stage 1 provider-close mappers", () => {
  it("maps Gmail one-to-one messages into normalized canonical event intake", () => {
    const result = mapGmailRecord({
      recordType: "message",
      recordId: "gmail-message-1",
      direction: "outbound",
      occurredAt: "2026-01-01T00:00:00.000Z",
      receivedAt: "2026-01-01T00:01:00.000Z",
      payloadRef: "payloads/gmail/gmail-message-1.json",
      checksum: "checksum-1",
      snippet: "Following up by email",
      capturedMailbox: "volunteers@example.org",
      projectInboxAlias: "project-antarctica@example.org",
      normalizedParticipantEmails: ["volunteer@example.org"],
      salesforceContactId: "003-stage1",
      volunteerIdPlainValues: [],
      normalizedPhones: [],
      supportingRecords: [
        {
          provider: "salesforce",
          providerRecordType: "task_communication",
          providerRecordId: "task-1"
        }
      ],
      crossProviderCollapseKey: "email-thread-1",
      threadId: "thread-1",
      rfc822MessageId: "<message-1@example.org>"
    });

    expect(result.outcome).toBe("command");
    if (result.outcome === "command") {
      expect(result.command.kind).toBe("canonical_event");
      if (result.command.kind === "canonical_event") {
        expect(result.command.input.canonicalEvent.eventType).toBe(
          "communication.email.outbound"
        );
        expect(result.command.input.canonicalEvent.idempotencyKey).toBe(
          "canonical-event:collapse:communication.email.outbound:email-thread-1"
        );
        expect(result.command.input.supportingSources).toEqual([
          {
            provider: "salesforce",
            sourceEvidenceId:
              "source-evidence:salesforce:task_communication:task-1"
          }
        ]);
        expect(result.command.input.identity.salesforceContactId).toBe("003-stage1");
      }
    }
  });

  it("maps Salesforce contact snapshots into contact graph upserts", () => {
    const result = mapSalesforceRecord({
      recordType: "contact_snapshot",
      recordId: "003-stage1",
      salesforceContactId: "003-stage1",
      displayName: "Stage One Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: "+15555550123",
      normalizedEmails: ["volunteer@example.org"],
      normalizedPhones: ["+15555550123"],
      volunteerIdPlainValues: ["VOL-123"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      memberships: [
        {
          projectId: "project_1",
          expeditionId: "expedition_1",
          role: "volunteer",
          status: "active"
        }
      ]
    });

    expect(result.outcome).toBe("command");
    if (result.outcome === "command") {
      expect(result.command.kind).toBe("contact_graph");
      if (result.command.kind === "contact_graph") {
        expect(result.command.input.contact.id).toBe(
          "contact:salesforce:003-stage1"
        );
        expect(result.command.input.identities.map((identity) => identity.kind)).toEqual(
          ["salesforce_contact_id", "volunteer_id_plain", "email", "phone"]
        );
        expect(result.command.input.identities[0]).toMatchObject({
          kind: "salesforce_contact_id",
          isPrimary: true
        });
        expect(result.command.input.identities[1]).toMatchObject({
          kind: "volunteer_id_plain",
          isPrimary: false
        });
        expect(result.command.input.memberships).toHaveLength(1);
      }
    }
  });

  it("maps the four locked Expedition_Members lifecycle source fields into canonical lifecycle events", () => {
    const lifecycleCases = [
      {
        recordId: "lifecycle-created",
        milestone: "signed_up" as const,
        sourceField: "Expedition_Members__c.CreatedDate" as const,
        expectedEventType: "lifecycle.signed_up" as const
      },
      {
        recordId: "lifecycle-training-sent",
        milestone: "received_training" as const,
        sourceField: "Expedition_Members__c.Date_Training_Sent__c" as const,
        expectedEventType: "lifecycle.received_training" as const
      },
      {
        recordId: "lifecycle-training-complete",
        milestone: "completed_training" as const,
        sourceField: "Expedition_Members__c.Date_Training_Completed__c" as const,
        expectedEventType: "lifecycle.completed_training" as const
      },
      {
        recordId: "lifecycle-first-sample",
        milestone: "submitted_first_data" as const,
        sourceField:
          "Expedition_Members__c.Date_First_Sample_Collected__c" as const,
        expectedEventType: "lifecycle.submitted_first_data" as const
      }
    ];

    for (const lifecycleCase of lifecycleCases) {
      const lifecycleResult = mapSalesforceRecord({
        recordType: "lifecycle_milestone",
        recordId: lifecycleCase.recordId,
        salesforceContactId: "003-stage1",
        milestone: lifecycleCase.milestone,
        sourceField: lifecycleCase.sourceField,
        occurredAt: "2026-01-01T00:00:00.000Z",
        receivedAt: "2026-01-01T00:01:00.000Z",
        payloadRef: `payloads/salesforce/${lifecycleCase.recordId}.json`,
        checksum: `checksum-${lifecycleCase.recordId}`,
        normalizedEmails: ["volunteer@example.org"],
        normalizedPhones: [],
        volunteerIdPlainValues: ["VOL-123"],
        routing: {
          required: true,
          projectId: "project_1",
          expeditionId: "expedition_1"
        }
      });

      expect(lifecycleResult.outcome).toBe("command");
      if (lifecycleResult.outcome === "command") {
        expect(lifecycleResult.command.kind).toBe("canonical_event");
        if (lifecycleResult.command.kind === "canonical_event") {
          expect(lifecycleResult.command.input.canonicalEvent.eventType).toBe(
            lifecycleCase.expectedEventType
          );
          expect(lifecycleResult.command.input.identity.salesforceContactId).toBe(
            "003-stage1"
          );
          expect(lifecycleResult.command.input.identity.volunteerIdPlainValues).toEqual([
            "VOL-123"
          ]);
          expect(lifecycleResult.command.input.routing).toEqual({
            required: true,
            projectId: "project_1",
            expeditionId: "expedition_1"
          });
        }
      }
    }
  });

  it("maps Salesforce task communication records into auto-message canonical events", () => {

    const taskResult = mapSalesforceRecord({
      recordType: "task_communication",
      recordId: "task-1",
      channel: "email",
      salesforceContactId: "003-stage1",
      occurredAt: "2026-01-01T00:02:00.000Z",
      receivedAt: "2026-01-01T00:03:00.000Z",
      payloadRef: "payloads/salesforce/task-1.json",
      checksum: "checksum-task-1",
      snippet: "Logged outbound follow-up",
      normalizedEmails: ["volunteer@example.org"],
      normalizedPhones: [],
      volunteerIdPlainValues: [],
      supportingRecords: [
        {
          provider: "gmail",
          providerRecordType: "message",
          providerRecordId: "gmail-message-1"
        }
      ],
      crossProviderCollapseKey: "email-thread-1",
      routing: {
        required: false,
        projectId: null,
        expeditionId: null
      }
    });

    expect(taskResult.outcome).toBe("command");
    if (taskResult.outcome === "command") {
      expect(taskResult.command.kind).toBe("canonical_event");
      if (taskResult.command.kind === "canonical_event") {
        expect(taskResult.command.input.canonicalEvent.eventType).toBe(
          "communication.email.outbound"
        );
        expect(taskResult.command.input.canonicalEvent.summary).toBe(
          "Outbound email sent"
        );
        expect(taskResult.command.input.canonicalEvent.idempotencyKey).toBe(
          "canonical-event:collapse:communication.email.outbound:email-thread-1"
        );
      }
    }
  });

  it("maps SimpleTexting transport and compliance records into canonical SMS events", () => {
    const outboundMessage = mapSimpleTextingRecord({
      recordType: "message",
      recordId: "sms-1",
      direction: "outbound",
      occurredAt: "2026-01-01T00:00:00.000Z",
      receivedAt: "2026-01-01T00:01:00.000Z",
      payloadRef: "payloads/simpletexting/sms-1.json",
      checksum: "checksum-sms-1",
      snippet: "Outbound SMS body",
      normalizedPhone: "+15555550123",
      salesforceContactId: "003-stage1",
      volunteerIdPlainValues: [],
      normalizedEmails: [],
      supportingRecords: [
        {
          provider: "salesforce",
          providerRecordType: "task_communication",
          providerRecordId: "task-sms-1"
        }
      ],
      crossProviderCollapseKey: "sms-thread-1"
    });

    expect(outboundMessage.outcome).toBe("command");
    if (outboundMessage.outcome === "command") {
      expect(outboundMessage.command.kind).toBe("canonical_event");
      if (outboundMessage.command.kind === "canonical_event") {
        expect(outboundMessage.command.input.canonicalEvent.eventType).toBe(
          "communication.sms.outbound"
        );
      }
    }

    const compliance = mapSimpleTextingRecord({
      recordType: "compliance",
      recordId: "compliance-1",
      complianceType: "opt_out",
      occurredAt: "2026-01-02T00:00:00.000Z",
      receivedAt: "2026-01-02T00:01:00.000Z",
      payloadRef: "payloads/simpletexting/compliance-1.json",
      checksum: "checksum-compliance-1",
      normalizedPhone: "+15555550123",
      salesforceContactId: null,
      volunteerIdPlainValues: [],
      normalizedEmails: []
    });

    expect(compliance.outcome).toBe("command");
    if (compliance.outcome === "command") {
      expect(compliance.command.kind).toBe("canonical_event");
      if (compliance.command.kind === "canonical_event") {
        expect(compliance.command.input.canonicalEvent.eventType).toBe(
          "communication.sms.opt_out"
        );
      }
    }
  });

  it("maps Mailchimp transition-period campaign activity and defers unsupported records", () => {
    const supported = mapMailchimpRecord({
      recordType: "campaign_member_activity",
      recordId: "campaign-activity-1",
      activityType: "clicked",
      occurredAt: "2026-01-03T00:00:00.000Z",
      receivedAt: "2026-01-03T00:01:00.000Z",
      payloadRef: "payloads/mailchimp/campaign-activity-1.json",
      checksum: "checksum-campaign-activity-1",
      normalizedEmail: "volunteer@example.org",
      salesforceContactId: "003-stage1",
      volunteerIdPlainValues: [],
      normalizedPhones: [],
      campaignId: "campaign-1",
      audienceId: "audience-1",
      memberId: "member-1",
      snippet: "Clicked the campaign CTA"
    });

    expect(supported.outcome).toBe("command");
    if (supported.outcome === "command") {
      expect(supported.command.kind).toBe("canonical_event");
      if (supported.command.kind === "canonical_event") {
        expect(supported.command.input.canonicalEvent.eventType).toBe(
          "campaign.email.clicked"
        );
      }
    }

    const deferred = mapMailchimpRecord({
      recordType: "automation_journey",
      recordId: "journey-1"
    });

    expect(deferred).toEqual({
      outcome: "deferred",
      provider: "mailchimp",
      sourceRecordType: "automation_journey",
      sourceRecordId: "journey-1",
      reason: "deferred_record_family",
      detail: "Mailchimp automation_journey records are deferred in Stage 1."
    });
  });
});
