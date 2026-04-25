import { describe, expect, it } from "vitest";

import {
  mapGmailRecord,
  mapMailchimpRecord,
  mapSalesforceRecord,
  parseSubjectDirection,
  mapSimpleTextingRecord
} from "../src/index.js";

describe("Stage 1 provider-close mappers", () => {
  it("parses Salesforce inbound task subjects and strips the arrow prefix", () => {
    expect(parseSubjectDirection("← Email: Re: Field update")).toEqual({
      direction: "inbound",
      cleanSubject: "Re: Field update"
    });
  });

  it("parses Salesforce outbound task subjects and strips the arrow prefix", () => {
    expect(parseSubjectDirection("→ Follow-up from AS")).toEqual({
      direction: "outbound",
      cleanSubject: "Follow-up from AS"
    });
  });

  it("defaults Salesforce task subjects without an arrow to outbound", () => {
    expect(parseSubjectDirection(" Status check ")).toEqual({
      direction: "outbound",
      cleanSubject: "Status check"
    });
  });

  it('strips the bare Salesforce "Email:" subject prefix', () => {
    expect(
      parseSubjectDirection(
        " Email: Aplicacion en Revision: Monitoreo y Restauracion de Arrecifes de Coral "
      )
    ).toEqual({
      direction: "outbound",
      cleanSubject:
        "Aplicacion en Revision: Monitoreo y Restauracion de Arrecifes de Coral"
    });
  });

  it("supports the unicode Salesforce arrow variants", () => {
    expect(parseSubjectDirection("⇐ Email: Inbound variant")).toEqual({
      direction: "inbound",
      cleanSubject: "Inbound variant"
    });
    expect(parseSubjectDirection("⇒ Outbound variant")).toEqual({
      direction: "outbound",
      cleanSubject: "Outbound variant"
    });
  });

  it("defaults null Salesforce task subjects to outbound with no subject", () => {
    expect(parseSubjectDirection(null)).toEqual({
      direction: "outbound",
      cleanSubject: null
    });
  });

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
      subject: "Checking in",
      snippetClean: "Following up by email",
      bodyTextPreview: "Following up by email with more context.",
      labelIds: ["SENT"],
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
        expect(result.command.input.communicationClassification).toEqual({
          messageKind: "one_to_one",
          sourceRecordType: "message",
          sourceRecordId: "gmail-message-1",
          campaignRef: null,
          threadRef: {
            crossProviderCollapseKey: "email-thread-1",
            providerThreadId: "thread-1"
          },
          direction: "outbound"
        });
        expect(result.command.input.gmailMessageDetail).toMatchObject({
          subject: "Checking in",
          labelIds: ["SENT"],
          snippetClean: "Following up by email",
          bodyTextPreview: "Following up by email with more context."
        });
      }
    }
  });

  it("skips Gmail draft-only messages before canonical ingest", () => {
    expect(
      mapGmailRecord({
        recordType: "message",
        recordId: "gmail-draft-1",
        direction: "outbound",
        occurredAt: "2026-01-01T00:00:00.000Z",
        receivedAt: "2026-01-01T00:01:00.000Z",
        payloadRef: "payloads/gmail/gmail-draft-1.json",
        checksum: "checksum-draft-1",
        snippet: "Drafting a reply",
        subject: "Checking in",
        fromHeader: null,
        toHeader: null,
        ccHeader: null,
        labelIds: ["DRAFT"],
        snippetClean: "Drafting a reply",
        bodyTextPreview: "Drafting a reply",
        capturedMailbox: "volunteers@example.org",
        projectInboxAlias: null,
        normalizedParticipantEmails: ["volunteer@example.org"],
        salesforceContactId: null,
        volunteerIdPlainValues: [],
        normalizedPhones: [],
        supportingRecords: [],
        crossProviderCollapseKey: null,
        threadId: "thread-draft-1",
        rfc822MessageId: "<draft-1@example.org>"
      })
    ).toEqual({
      outcome: "deferred",
      provider: "gmail",
      sourceRecordType: "message",
      sourceRecordId: "gmail-draft-1",
      reason: "skipped_by_policy",
      detail: "Gmail draft-only messages are skipped before canonical ingest."
    });
  });

  it("keeps Gmail messages that already have SENT even if DRAFT is still present", () => {
    const result = mapGmailRecord({
      recordType: "message",
      recordId: "gmail-sent-1",
      direction: "outbound",
      occurredAt: "2026-01-01T00:00:00.000Z",
      receivedAt: "2026-01-01T00:01:00.000Z",
      payloadRef: "payloads/gmail/gmail-sent-1.json",
      checksum: "checksum-sent-1",
      snippet: "Sent reply",
      subject: "Checking in",
      fromHeader: "Project <project@example.org>",
      toHeader: "Volunteer <volunteer@example.org>",
      ccHeader: null,
      labelIds: ["DRAFT", "SENT"],
      snippetClean: "Sent reply",
      bodyTextPreview: "Sent reply with final text.",
      capturedMailbox: "volunteers@example.org",
      projectInboxAlias: null,
      normalizedParticipantEmails: ["volunteer@example.org"],
      salesforceContactId: null,
      volunteerIdPlainValues: [],
      normalizedPhones: [],
      supportingRecords: [],
      crossProviderCollapseKey: null,
      threadId: "thread-sent-1",
      rfc822MessageId: "<sent-1@example.org>"
    });

    expect(result.outcome).toBe("command");
  });

  it("keeps Gmail inbound messages whose labels are absent", () => {
    const result = mapGmailRecord({
      recordType: "message",
      recordId: "gmail-inbound-1",
      direction: "inbound",
      occurredAt: "2026-01-01T00:00:00.000Z",
      receivedAt: "2026-01-01T00:01:00.000Z",
      payloadRef: "payloads/gmail/gmail-inbound-1.json",
      checksum: "checksum-inbound-1",
      snippet: "Inbound question",
      subject: "Question",
      fromHeader: "Volunteer <volunteer@example.org>",
      toHeader: "Project <project@example.org>",
      ccHeader: null,
      snippetClean: "Inbound question",
      bodyTextPreview: "Inbound question with more detail.",
      capturedMailbox: "volunteers@example.org",
      projectInboxAlias: null,
      normalizedParticipantEmails: ["volunteer@example.org"],
      salesforceContactId: null,
      volunteerIdPlainValues: [],
      normalizedPhones: [],
      supportingRecords: [],
      crossProviderCollapseKey: null,
      threadId: "thread-inbound-1",
      rfc822MessageId: "<inbound-1@example.org>"
    });

    expect(result.outcome).toBe("command");
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
          salesforceId: "a0B-membership-1",
          projectId: "project_1",
          projectName: "Project Antarctica",
          expeditionId: "expedition_1",
          expeditionName: "Expedition Antarctica",
          role: "volunteer",
          status: "active"
        }
      ]
    });

      expect(result.outcome).toBe("command");
      if (result.outcome === "command") {
        expect(result.command.kind).toBe("contact_graph");
        if (result.command.kind === "contact_graph") {
          const identities = result.command.input.identities ?? [];

          expect(result.command.input.contact.id).toBe(
            "contact:salesforce:003-stage1"
          );
          expect(identities.map((identity) => identity.kind)).toEqual([
            "salesforce_contact_id",
            "volunteer_id_plain",
            "email",
            "phone"
          ]);
          expect(identities[0]).toMatchObject({
            kind: "salesforce_contact_id",
            isPrimary: true
          });
          expect(identities[1]).toMatchObject({
            kind: "volunteer_id_plain",
            isPrimary: false
          });
          expect(result.command.input.memberships).toHaveLength(1);
          expect(result.command.input.projectDimensions).toEqual([
            {
            projectId: "project_1",
            projectName: "Project Antarctica",
            source: "salesforce"
          }
        ]);
        expect(result.command.input.expeditionDimensions).toEqual([
          {
            expeditionId: "expedition_1",
            projectId: "project_1",
            expeditionName: "Expedition Antarctica",
            source: "salesforce"
          }
        ]);
      }
    }
  });

  it("defers Salesforce contact snapshots that are not backed by expedition memberships", () => {
    const result = mapSalesforceRecord({
      recordType: "contact_snapshot",
      recordId: "003-non-volunteer",
      salesforceContactId: "003-non-volunteer",
      displayName: "Non Volunteer Contact",
      primaryEmail: "donor@example.org",
      primaryPhone: null,
      normalizedEmails: ["donor@example.org"],
      normalizedPhones: [],
      volunteerIdPlainValues: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      memberships: []
    });

    expect(result).toEqual({
      outcome: "deferred",
      provider: "salesforce",
      sourceRecordType: "contact_snapshot",
      sourceRecordId: "003-non-volunteer",
      reason: "deferred_record_family",
      detail:
        "Salesforce contact_snapshot records without expedition memberships are skipped in Stage 1."
    });
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
          expeditionId: "expedition_1",
          projectName: "Project Antarctica",
          expeditionName: "Expedition Antarctica"
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
            expeditionId: "expedition_1",
            projectName: "Project Antarctica",
            expeditionName: "Expedition Antarctica"
          });
          expect(lifecycleResult.command.input.salesforceEventContext).toEqual({
            sourceEvidenceId: `source-evidence:salesforce:lifecycle_milestone:${lifecycleCase.recordId}`,
            salesforceContactId: "003-stage1",
            projectId: "project_1",
            expeditionId: "expedition_1",
            sourceField: lifecycleCase.sourceField
          });
          expect(lifecycleResult.command.input.projectDimensions).toEqual([
            {
              projectId: "project_1",
              projectName: "Project Antarctica",
              source: "salesforce"
            }
          ]);
          expect(lifecycleResult.command.input.expeditionDimensions).toEqual([
            {
              expeditionId: "expedition_1",
              projectId: "project_1",
              expeditionName: "Expedition Antarctica",
              source: "salesforce"
            }
          ]);
        }
      }
    }
  });

  it("maps Salesforce task communication records into classified canonical events", () => {

    const taskResult = mapSalesforceRecord({
      recordType: "task_communication",
      recordId: "task-1",
      channel: "email",
      messageKind: "one_to_one",
      salesforceContactId: "003-stage1",
      occurredAt: "2026-01-01T00:02:00.000Z",
      receivedAt: "2026-01-01T00:03:00.000Z",
      payloadRef: "payloads/salesforce/task-1.json",
      checksum: "checksum-task-1",
      subject: "Logged outbound follow-up",
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
        expeditionId: null,
        projectName: null,
        expeditionName: null
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
        expect(taskResult.command.input.communicationClassification).toEqual({
          messageKind: "one_to_one",
          sourceRecordType: "task_communication",
          sourceRecordId: "task-1",
          campaignRef: null,
          threadRef: {
            crossProviderCollapseKey: "email-thread-1",
            providerThreadId: null
          },
          direction: "outbound"
        });
        expect(taskResult.command.input.salesforceCommunicationDetail).toEqual({
          sourceEvidenceId:
            "source-evidence:salesforce:task_communication:task-1",
          providerRecordId: "task-1",
          channel: "email",
          messageKind: "one_to_one",
          subject: "Logged outbound follow-up",
          snippet: "Logged outbound follow-up",
          sourceLabel: "Salesforce Task"
        });
        expect(taskResult.command.input.canonicalEvent.idempotencyKey).toBe(
          "canonical-event:collapse:communication.email.outbound:email-thread-1"
        );
      }
    }
  });

  it("maps Salesforce inbound task communication records into inbound canonical events", () => {
    const taskResult = mapSalesforceRecord({
      recordType: "task_communication",
      recordId: "task-inbound-1",
      channel: "email",
      messageKind: "one_to_one",
      salesforceContactId: "003-stage1",
      occurredAt: "2026-01-01T00:02:00.000Z",
      receivedAt: "2026-01-01T00:03:00.000Z",
      payloadRef: "payloads/salesforce/task-inbound-1.json",
      checksum: "checksum-task-inbound-1",
      subject: "← Email: Re: Field update",
      snippet: "Inbound update from the volunteer",
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
    });

    expect(taskResult.outcome).toBe("command");
    if (taskResult.outcome === "command") {
      expect(taskResult.command.kind).toBe("canonical_event");
      if (taskResult.command.kind === "canonical_event") {
        expect(taskResult.command.input.canonicalEvent.eventType).toBe(
          "communication.email.inbound"
        );
        expect(taskResult.command.input.canonicalEvent.summary).toBe(
          "Inbound email received"
        );
        expect(taskResult.command.input.communicationClassification).toEqual({
          messageKind: "one_to_one",
          sourceRecordType: "task_communication",
          sourceRecordId: "task-inbound-1",
          campaignRef: null,
          threadRef: {
            crossProviderCollapseKey: null,
            providerThreadId: null
          },
          direction: "inbound"
        });
        expect(taskResult.command.input.salesforceCommunicationDetail).toEqual({
          sourceEvidenceId:
            "source-evidence:salesforce:task_communication:task-inbound-1",
          providerRecordId: "task-inbound-1",
          channel: "email",
          messageKind: "one_to_one",
          subject: "Re: Field update",
          snippet: "Inbound update from the volunteer",
          sourceLabel: "Salesforce Task"
        });
      }
    }
  });

  it("maps Salesforce auto task communication records into auto-classified canonical events", () => {
    const taskResult = mapSalesforceRecord({
      recordType: "task_communication",
      recordId: "task-auto-1",
      channel: "sms",
      messageKind: "auto",
      salesforceContactId: "003-stage1",
      occurredAt: "2026-01-01T00:04:00.000Z",
      receivedAt: "2026-01-01T00:05:00.000Z",
      payloadRef: "payloads/salesforce/task-auto-1.json",
      checksum: "checksum-task-auto-1",
      subject: null,
      snippet: "Automated Salesforce SMS",
      normalizedEmails: [],
      normalizedPhones: ["+15555550123"],
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
    });

    expect(taskResult.outcome).toBe("command");
    if (taskResult.outcome === "command") {
      expect(taskResult.command.kind).toBe("canonical_event");
      if (taskResult.command.kind === "canonical_event") {
        expect(taskResult.command.input.canonicalEvent.eventType).toBe(
          "communication.sms.outbound"
        );
        expect(taskResult.command.input.communicationClassification).toEqual({
          messageKind: "auto",
          sourceRecordType: "task_communication",
          sourceRecordId: "task-auto-1",
          campaignRef: null,
          threadRef: {
            crossProviderCollapseKey: null,
            providerThreadId: null
          },
          direction: "outbound"
        });
        expect(taskResult.command.input.salesforceCommunicationDetail).toEqual({
          sourceEvidenceId:
            "source-evidence:salesforce:task_communication:task-auto-1",
          providerRecordId: "task-auto-1",
          channel: "sms",
          messageKind: "auto",
          subject: null,
          snippet: "Automated Salesforce SMS",
          sourceLabel: "Salesforce Flow"
        });
      }
    }
  });

  it("maps SimpleTexting transport and compliance records into canonical SMS events", () => {
    const outboundMessage = mapSimpleTextingRecord({
      recordType: "message",
      recordId: "sms-1",
      direction: "outbound",
      messageKind: "campaign",
      occurredAt: "2026-01-01T00:00:00.000Z",
      receivedAt: "2026-01-01T00:01:00.000Z",
      payloadRef: "payloads/simpletexting/sms-1.json",
      checksum: "checksum-sms-1",
      snippet: "Outbound SMS body",
      normalizedPhone: "+15555550123",
      campaignId: "campaign-1",
      campaignName: "Launch SMS",
      providerThreadId: "simpletexting-thread-1",
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
        expect(outboundMessage.command.input.communicationClassification).toEqual({
          messageKind: "campaign",
          sourceRecordType: "message",
          sourceRecordId: "sms-1",
          campaignRef: {
            providerCampaignId: "campaign-1",
            providerAudienceId: null,
            providerMessageName: "Launch SMS"
          },
          threadRef: {
            crossProviderCollapseKey: "sms-thread-1",
            providerThreadId: "simpletexting-thread-1"
          },
          direction: "outbound"
        });
        expect(outboundMessage.command.input.simpleTextingMessageDetail).toEqual({
          sourceEvidenceId: "source-evidence:simpletexting:message:sms-1",
          providerRecordId: "sms-1",
          direction: "outbound",
          messageKind: "campaign",
          messageTextPreview: "Outbound SMS body",
          normalizedPhone: "+15555550123",
          campaignId: "campaign-1",
          campaignName: "Launch SMS",
          providerThreadId: "simpletexting-thread-1",
          threadKey: "sms-thread-1"
        });
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
      campaignName: "Welcome Series",
      snippet: "Clicked the campaign CTA"
    });

    expect(supported.outcome).toBe("command");
    if (supported.outcome === "command") {
      expect(supported.command.kind).toBe("canonical_event");
      if (supported.command.kind === "canonical_event") {
        expect(supported.command.input.canonicalEvent.eventType).toBe(
          "campaign.email.clicked"
        );
        expect(supported.command.input.canonicalEvent.idempotencyKey).toBe(
          "canonical-event:collapse:campaign.email.clicked:mailchimp:audience-1:campaign-1:member-1:clicked"
        );
        expect(supported.command.input.mailchimpCampaignActivityDetail).toEqual({
          sourceEvidenceId:
            "source-evidence:mailchimp:campaign_member_activity:campaign-activity-1",
          providerRecordId: "campaign-activity-1",
          activityType: "clicked",
          campaignId: "campaign-1",
          audienceId: "audience-1",
          memberId: "member-1",
          campaignName: "Welcome Series",
          snippet: "Clicked the campaign CTA"
        });
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
