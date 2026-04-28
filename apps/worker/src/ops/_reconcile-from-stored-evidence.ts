import type {
  ContactIdentityKind,
  ExpeditionDimensionRecord,
  GmailMessageDetailRecord,
  IdentityResolutionCase,
  MailchimpCampaignActivityDetailRecord,
  NormalizedCanonicalEventIntake,
  ProjectDimensionRecord,
  SalesforceCommunicationDetailRecord,
  SalesforceEventContextRecord,
  SourceEvidenceRecord
} from "@as-comms/contracts";
import type { Stage1RepositoryBundle } from "@as-comms/domain";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SALESFORCE_CONTACT_ID_PATTERN = /^003[\w-]+$/u;
const NORMALIZED_PHONE_PATTERN = /^\+[1-9]\d{6,}$/u;
const ADVENTURE_SCIENTISTS_DOMAIN = "@adventurescientists.org";

function encodeIdPart(value: string): string {
  return encodeURIComponent(value);
}

function buildCanonicalEventCorrelationKey(input: {
  readonly provider: SourceEvidenceRecord["provider"];
  readonly providerRecordType: string;
  readonly providerRecordId: string;
  readonly eventType: NormalizedCanonicalEventIntake["canonicalEvent"]["eventType"];
  readonly crossProviderCollapseKey: string | null;
}): string {
  if (input.crossProviderCollapseKey !== null) {
    return `collapse:${input.eventType}:${input.crossProviderCollapseKey}`;
  }

  return `${input.provider}:${input.providerRecordType}:${input.providerRecordId}`;
}

function buildCanonicalEventId(input: {
  readonly provider: SourceEvidenceRecord["provider"];
  readonly providerRecordType: string;
  readonly providerRecordId: string;
  readonly eventType: NormalizedCanonicalEventIntake["canonicalEvent"]["eventType"];
  readonly crossProviderCollapseKey: string | null;
}): string {
  return `canonical-event:${encodeIdPart(buildCanonicalEventCorrelationKey(input))}`;
}

function buildCanonicalEventIdempotencyKey(input: {
  readonly provider: SourceEvidenceRecord["provider"];
  readonly providerRecordType: string;
  readonly providerRecordId: string;
  readonly eventType: NormalizedCanonicalEventIntake["canonicalEvent"]["eventType"];
  readonly crossProviderCollapseKey: string | null;
}): string {
  return `canonical-event:${buildCanonicalEventCorrelationKey(input)}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
  ).sort((left, right) => left.localeCompare(right));
}

function isAdventureScientistsEmail(value: string): boolean {
  return (
    EMAIL_PATTERN.test(value) &&
    value.toLowerCase().endsWith(ADVENTURE_SCIENTISTS_DOMAIN)
  );
}

function filterReplayIdentityValues(input: {
  readonly provider: SourceEvidenceRecord["provider"];
  readonly normalizedIdentityValues: readonly string[];
}): string[] {
  const values = uniqueStrings(input.normalizedIdentityValues);

  if (input.provider !== "gmail") {
    return values;
  }

  const emailValues = values.filter((value) => EMAIL_PATTERN.test(value));
  const externalEmails = emailValues.filter(
    (value) => !isAdventureScientistsEmail(value)
  );

  if (externalEmails.length !== 1 || externalEmails.length === emailValues.length) {
    return values;
  }

  return values.filter((value) => !isAdventureScientistsEmail(value));
}

function buildIdentityFromCase(input: {
  readonly caseRecord: IdentityResolutionCase;
  readonly provider: SourceEvidenceRecord["provider"];
  readonly preferredSalesforceContactId?: string | null;
}): NormalizedCanonicalEventIntake["identity"] {
  const normalizedEmails: string[] = [];
  const normalizedPhones: string[] = [];
  const volunteerIdPlainValues: string[] = [];
  let salesforceContactId = input.preferredSalesforceContactId ?? null;

  for (const value of filterReplayIdentityValues({
    provider: input.provider,
    normalizedIdentityValues: input.caseRecord.normalizedIdentityValues
  })) {
    if (salesforceContactId !== null && value === salesforceContactId) {
      continue;
    }

    if (EMAIL_PATTERN.test(value)) {
      normalizedEmails.push(value);
      continue;
    }

    if (NORMALIZED_PHONE_PATTERN.test(value)) {
      normalizedPhones.push(value);
      continue;
    }

    if (salesforceContactId === null && SALESFORCE_CONTACT_ID_PATTERN.test(value)) {
      salesforceContactId = value;
      continue;
    }

    volunteerIdPlainValues.push(value);
  }

  return {
    salesforceContactId,
    volunteerIdPlainValues: uniqueStrings(volunteerIdPlainValues),
    normalizedEmails: uniqueStrings(normalizedEmails),
    normalizedPhones: uniqueStrings(normalizedPhones)
  };
}

async function resolvePreferredSalesforceContactId(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly caseRecord: IdentityResolutionCase;
  readonly provider: SourceEvidenceRecord["provider"];
}): Promise<string | null> {
  const identity = buildIdentityFromCase({
    caseRecord: input.caseRecord,
    provider: input.provider
  });
  const lookups: readonly {
    readonly kind: ContactIdentityKind;
    readonly values: readonly string[];
  }[] = [
    {
      kind: "email",
      values: identity.normalizedEmails ?? []
    },
    {
      kind: "phone",
      values: identity.normalizedPhones ?? []
    },
    {
      kind: "volunteer_id_plain",
      values: identity.volunteerIdPlainValues ?? []
    }
  ];
  const matchingIdentities = (
    await Promise.all(
      lookups.map(({ kind, values }) =>
        Promise.all(
          uniqueStrings(values).map((normalizedValue) =>
            input.repositories.contactIdentities.listByNormalizedValue({
              kind,
              normalizedValue
            })
          )
        )
      )
    )
  ).flat(2);
  const uniqueContactIds = uniqueStrings(
    matchingIdentities.map((identityRecord) => identityRecord.contactId)
  );

  if (uniqueContactIds.length !== 1) {
    return null;
  }

  const [matchedContact] = await input.repositories.contacts.listByIds(
    uniqueContactIds
  );

  return matchedContact?.salesforceContactId ?? null;
}

function requireSingleDetail<TDetail>(
  detail: TDetail | undefined,
  message: string
): TDetail {
  if (detail === undefined) {
    throw new Error(message);
  }

  return detail;
}

function buildGmailSummary(
  direction: GmailMessageDetailRecord["direction"]
): string {
  return direction === "inbound"
    ? "Inbound email received"
    : "Outbound email sent";
}

function buildSimpleTextingSummary(
  eventType: NormalizedCanonicalEventIntake["canonicalEvent"]["eventType"]
): string {
  switch (eventType) {
    case "communication.sms.inbound":
      return "Inbound SMS received";
    case "communication.sms.outbound":
      return "Outbound SMS sent";
    case "communication.sms.opt_in":
      return "SMS opt-in received";
    case "communication.sms.opt_out":
      return "SMS opt-out received";
    default:
      throw new Error(
        `Unsupported SimpleTexting event type ${eventType} for stored-evidence reconciliation.`
      );
  }
}

function buildMailchimpSummary(
  activityType: MailchimpCampaignActivityDetailRecord["activityType"]
): string {
  switch (activityType) {
    case "sent":
      return "Campaign email sent";
    case "opened":
      return "Campaign email opened";
    case "clicked":
      return "Campaign email clicked";
    case "unsubscribed":
      return "Campaign email unsubscribed";
  }
}

function buildSalesforceTaskSummary(input: {
  readonly eventType: NormalizedCanonicalEventIntake["canonicalEvent"]["eventType"];
  readonly messageKind: SalesforceCommunicationDetailRecord["messageKind"];
}): string {
  switch (input.eventType) {
    case "communication.email.inbound":
      return "Inbound email received";
    case "communication.email.outbound":
      return input.messageKind === "auto"
        ? "Auto email sent"
        : "Outbound email sent";
    case "communication.sms.outbound":
      return input.messageKind === "auto"
        ? "Auto SMS sent"
        : "Outbound SMS sent";
    default:
      throw new Error(
        `Unsupported Salesforce event type ${input.eventType} for stored-evidence reconciliation.`
      );
  }
}

function buildRoutingContext(input: {
  readonly eventContext: SalesforceEventContextRecord | undefined;
  readonly project: ProjectDimensionRecord | undefined;
  readonly expedition: ExpeditionDimensionRecord | undefined;
}): NonNullable<NormalizedCanonicalEventIntake["routing"]> | undefined {
  if (input.eventContext === undefined) {
    return undefined;
  }

  return {
    required:
      input.eventContext.projectId !== null || input.eventContext.expeditionId !== null,
    projectId: input.eventContext.projectId,
    expeditionId: input.eventContext.expeditionId,
    projectName: input.project?.projectName ?? null,
    expeditionName: input.expedition?.expeditionName ?? null
  };
}

function parseSubjectDirection(rawSubject: string | null): {
  readonly direction: "inbound" | "outbound";
  readonly cleanSubject: string | null;
} {
  if (rawSubject === null) {
    return {
      direction: "outbound",
      cleanSubject: null
    };
  }

  const trimmed = rawSubject.trim();

  if (trimmed.length === 0) {
    return {
      direction: "outbound",
      cleanSubject: null
    };
  }

  const normalizeCleanSubject = (value: string): string | null => {
    const cleaned = value.trim();
    return cleaned.length > 0 ? cleaned : null;
  };

  if (trimmed.startsWith("←") || trimmed.startsWith("⇐")) {
    return {
      direction: "inbound",
      cleanSubject: normalizeCleanSubject(
        trimmed.replace(/^[←⇐]\s*(?:Email:\s*)?/u, "")
      )
    };
  }

  if (trimmed.startsWith("→") || trimmed.startsWith("⇒")) {
    return {
      direction: "outbound",
      cleanSubject: normalizeCleanSubject(
        trimmed.replace(/^[→⇒]\s*(?:Email:\s*)?/u, "")
      )
    };
  }

  return {
    direction: "outbound",
    cleanSubject: normalizeCleanSubject(
      trimmed.replace(/^Email:\s*/iu, "")
    )
  };
}

export async function buildEventFromStoredData(input: {
  readonly repositories: Stage1RepositoryBundle;
  readonly sourceEvidence: SourceEvidenceRecord;
  readonly caseRecord: IdentityResolutionCase;
}): Promise<NormalizedCanonicalEventIntake> {
  const sourceEvidenceId = input.sourceEvidence.id;

  switch (input.sourceEvidence.provider) {
    case "gmail": {
      const preferredSalesforceContactId =
        await resolvePreferredSalesforceContactId({
          repositories: input.repositories,
          caseRecord: input.caseRecord,
          provider: input.sourceEvidence.provider
        });
      const detail = requireSingleDetail(
        (
          await input.repositories.gmailMessageDetails.listBySourceEvidenceIds([
            sourceEvidenceId
          ])
        )[0],
        `Expected gmail_message_details to exist for source evidence ${sourceEvidenceId}.`
      );
      const crossProviderCollapseKey =
        detail.rfc822MessageId === null
          ? null
          : `rfc822:${detail.rfc822MessageId.toLowerCase()}`;
      const eventType =
        detail.direction === "inbound"
          ? "communication.email.inbound"
          : "communication.email.outbound";
      const snippet =
        detail.snippetClean.trim().length > 0
          ? detail.snippetClean
          : detail.bodyTextPreview;

      return {
        sourceEvidence: input.sourceEvidence,
        canonicalEvent: {
          id: buildCanonicalEventId({
            provider: "gmail",
            providerRecordType: input.sourceEvidence.providerRecordType,
            providerRecordId: input.sourceEvidence.providerRecordId,
            eventType,
            crossProviderCollapseKey
          }),
          eventType,
          occurredAt: input.sourceEvidence.occurredAt,
          idempotencyKey: buildCanonicalEventIdempotencyKey({
            provider: "gmail",
            providerRecordType: input.sourceEvidence.providerRecordType,
            providerRecordId: input.sourceEvidence.providerRecordId,
            eventType,
            crossProviderCollapseKey
          }),
          summary: buildGmailSummary(detail.direction),
          snippet
        },
        identity: buildIdentityFromCase({
          caseRecord: input.caseRecord,
          provider: input.sourceEvidence.provider,
          preferredSalesforceContactId
        }),
        supportingSources: [],
        communicationClassification: {
          messageKind: "one_to_one",
          sourceRecordType: input.sourceEvidence.providerRecordType,
          sourceRecordId: input.sourceEvidence.providerRecordId,
          campaignRef: null,
          threadRef: {
            crossProviderCollapseKey,
            providerThreadId: detail.gmailThreadId
          },
          direction: detail.direction
        },
        gmailMessageDetail: detail
      };
    }
    case "salesforce": {
      const [detail, eventContext] = await Promise.all([
        input.repositories.salesforceCommunicationDetails.listBySourceEvidenceIds([
          sourceEvidenceId
        ]),
        input.repositories.salesforceEventContext.listBySourceEvidenceIds([
          sourceEvidenceId
        ])
      ]);
      const communicationDetail = requireSingleDetail(
        detail[0],
        `Expected salesforce_communication_details to exist for source evidence ${sourceEvidenceId}.`
      );
      const context = eventContext[0];
      const [project, expedition] = await Promise.all([
        context?.projectId === null || context?.projectId === undefined
          ? Promise.resolve(undefined)
          : input.repositories.projectDimensions
              .listByIds([context.projectId])
              .then((records) => records[0]),
        context?.expeditionId === null || context?.expeditionId === undefined
          ? Promise.resolve(undefined)
          : input.repositories.expeditionDimensions
              .listByIds([context.expeditionId])
              .then((records) => records[0])
      ]);
      const subjectDirection =
        communicationDetail.channel === "email"
          ? parseSubjectDirection(communicationDetail.subject)
          : {
              direction: "outbound" as const,
              cleanSubject: communicationDetail.subject
            };
      const eventType =
        communicationDetail.channel === "email"
          ? subjectDirection.direction === "inbound"
            ? "communication.email.inbound"
            : "communication.email.outbound"
          : "communication.sms.outbound";
      const routing = buildRoutingContext({
        eventContext: context,
        project,
        expedition
      });

      return {
        sourceEvidence: input.sourceEvidence,
        canonicalEvent: {
          id: buildCanonicalEventId({
            provider: "salesforce",
            providerRecordType: input.sourceEvidence.providerRecordType,
            providerRecordId: input.sourceEvidence.providerRecordId,
            eventType,
            crossProviderCollapseKey: null
          }),
          eventType,
          occurredAt: input.sourceEvidence.occurredAt,
          idempotencyKey: buildCanonicalEventIdempotencyKey({
            provider: "salesforce",
            providerRecordType: input.sourceEvidence.providerRecordType,
            providerRecordId: input.sourceEvidence.providerRecordId,
            eventType,
            crossProviderCollapseKey: null
          }),
          summary: buildSalesforceTaskSummary({
            eventType,
            messageKind: communicationDetail.messageKind
          }),
          snippet: communicationDetail.snippet
        },
        identity: buildIdentityFromCase({
          caseRecord: input.caseRecord,
          provider: input.sourceEvidence.provider,
          preferredSalesforceContactId: context?.salesforceContactId ?? null
        }),
        ...(routing === undefined ? {} : { routing }),
        supportingSources: [],
        communicationClassification: {
          messageKind: communicationDetail.messageKind,
          sourceRecordType: input.sourceEvidence.providerRecordType,
          sourceRecordId: input.sourceEvidence.providerRecordId,
          campaignRef: null,
          threadRef: {
            crossProviderCollapseKey: null,
            providerThreadId: null
          },
          direction: subjectDirection.direction
        },
        salesforceCommunicationDetail: {
          ...communicationDetail,
          subject: subjectDirection.cleanSubject
        },
        ...(context === undefined ? {} : { salesforceEventContext: context }),
        projectDimensions:
          project === undefined
            ? []
            : [
                {
                  projectId: project.projectId,
                  projectName: project.projectName,
                  source: project.source
                }
              ],
        expeditionDimensions:
          expedition === undefined
            ? []
            : [
                {
                  expeditionId: expedition.expeditionId,
                  projectId: expedition.projectId,
                  expeditionName: expedition.expeditionName,
                  source: expedition.source
                }
              ]
      };
    }
    case "simpletexting": {
      const preferredSalesforceContactId =
        await resolvePreferredSalesforceContactId({
          repositories: input.repositories,
          caseRecord: input.caseRecord,
          provider: input.sourceEvidence.provider
        });
      const detail = requireSingleDetail(
        (
          await input.repositories.simpleTextingMessageDetails.listBySourceEvidenceIds([
            sourceEvidenceId
          ])
        )[0],
        `Expected simpletexting_message_details to exist for source evidence ${sourceEvidenceId}.`
      );
      const eventType =
        detail.direction === "inbound"
          ? "communication.sms.inbound"
          : "communication.sms.outbound";

      return {
        sourceEvidence: input.sourceEvidence,
        canonicalEvent: {
          id: buildCanonicalEventId({
            provider: "simpletexting",
            providerRecordType: input.sourceEvidence.providerRecordType,
            providerRecordId: input.sourceEvidence.providerRecordId,
            eventType,
            crossProviderCollapseKey: detail.threadKey
          }),
          eventType,
          occurredAt: input.sourceEvidence.occurredAt,
          idempotencyKey: buildCanonicalEventIdempotencyKey({
            provider: "simpletexting",
            providerRecordType: input.sourceEvidence.providerRecordType,
            providerRecordId: input.sourceEvidence.providerRecordId,
            eventType,
            crossProviderCollapseKey: detail.threadKey
          }),
          summary: buildSimpleTextingSummary(eventType),
          snippet: detail.messageTextPreview
        },
        identity: buildIdentityFromCase({
          caseRecord: input.caseRecord,
          provider: input.sourceEvidence.provider,
          preferredSalesforceContactId
        }),
        supportingSources: [],
        communicationClassification: {
          messageKind: detail.messageKind,
          sourceRecordType: input.sourceEvidence.providerRecordType,
          sourceRecordId: input.sourceEvidence.providerRecordId,
          campaignRef:
            detail.messageKind === "campaign"
              ? {
                  providerCampaignId: detail.campaignId,
                  providerAudienceId: null,
                  providerMessageName: detail.campaignName
                }
              : null,
          threadRef: {
            crossProviderCollapseKey: detail.threadKey,
            providerThreadId: detail.providerThreadId
          },
          direction: detail.direction
        },
        simpleTextingMessageDetail: detail
      };
    }
    case "mailchimp": {
      const preferredSalesforceContactId =
        await resolvePreferredSalesforceContactId({
          repositories: input.repositories,
          caseRecord: input.caseRecord,
          provider: input.sourceEvidence.provider
        });
      const detail = requireSingleDetail(
        (
          await input.repositories.mailchimpCampaignActivityDetails.listBySourceEvidenceIds(
            [sourceEvidenceId]
          )
        )[0],
        `Expected mailchimp_campaign_activity_details to exist for source evidence ${sourceEvidenceId}.`
      );
      const eventType =
        detail.activityType === "sent"
          ? "campaign.email.sent"
          : detail.activityType === "opened"
            ? "campaign.email.opened"
            : detail.activityType === "clicked"
              ? "campaign.email.clicked"
              : "campaign.email.unsubscribed";
      const crossProviderCollapseKey = [
        "mailchimp",
        detail.audienceId,
        detail.campaignId,
        detail.memberId,
        detail.activityType
      ].join(":");

      return {
        sourceEvidence: input.sourceEvidence,
        canonicalEvent: {
          id: buildCanonicalEventId({
            provider: "mailchimp",
            providerRecordType: input.sourceEvidence.providerRecordType,
            providerRecordId: input.sourceEvidence.providerRecordId,
            eventType,
            crossProviderCollapseKey
          }),
          eventType,
          occurredAt: input.sourceEvidence.occurredAt,
          idempotencyKey: buildCanonicalEventIdempotencyKey({
            provider: "mailchimp",
            providerRecordType: input.sourceEvidence.providerRecordType,
            providerRecordId: input.sourceEvidence.providerRecordId,
            eventType,
            crossProviderCollapseKey
          }),
          summary: buildMailchimpSummary(detail.activityType),
          snippet: detail.snippet
        },
        identity: buildIdentityFromCase({
          caseRecord: input.caseRecord,
          provider: input.sourceEvidence.provider,
          preferredSalesforceContactId
        }),
        supportingSources: [],
        mailchimpCampaignActivityDetail: detail
      };
    }
    case "manual":
      throw new Error(
        `Manual source evidence ${sourceEvidenceId} cannot be reconciled through the identity queue operation.`
      );
  }
}
