import { describe, expect, it } from "vitest";

import {
  audienceSnapshots,
  campaignRuns,
  composerDrafts,
  consentRecords,
  contactConsent,
  contactTimelineProjection,
  smsSenders,
} from "@as-comms/db";
import { sql } from "drizzle-orm";

import { createTestStage1Context } from "./helpers.js";
import { mergeSfContactPair } from "../src/ops/merge-sf-contact-pair.js";

type WorkerContext = Awaited<ReturnType<typeof createTestStage1Context>>;

const MASTER_SF_ID = "003000000000000AAA";
const DUPLICATE_SF_ID = "003000000000000AAB";
const MASTER_LOCAL_ID = `contact:salesforce:${MASTER_SF_ID}`;
const DUPLICATE_LOCAL_ID = `contact:salesforce:${DUPLICATE_SF_ID}`;
const CAMPAIGN_RUN_ALPHA_ID = "campaign-run:alpha";
const CAMPAIGN_RUN_BETA_ID = "campaign-run:beta";
const COMPOSER_DRAFT_ID = "00000000-0000-4000-8000-000000000111";
const NOW = new Date("2026-07-23T12:00:00.000Z");

interface CountRow {
  readonly value: number | string;
}

function createLogger() {
  const state = {
    logs: [] as string[],
    errors: [] as string[],
  };

  return {
    ...state,
    logger: {
      log(...args: readonly unknown[]) {
        state.logs.push(args.map(String).join(" "));
      },
      error(...args: readonly unknown[]) {
        state.errors.push(args.map(String).join(" "));
      },
    },
  };
}

function buildCanonicalProvenance(input: {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly direction: "inbound" | "outbound";
}) {
  return {
    primaryProvider: "gmail" as const,
    primarySourceEvidenceId: input.sourceEvidenceId,
    supportingSourceEvidenceIds: [],
    winnerReason: "single_source" as const,
    sourceRecordType: "message",
    sourceRecordId: input.providerRecordId,
    messageKind: "one_to_one" as const,
    campaignRef: null,
    threadRef: {
      crossProviderCollapseKey: `rfc822:<${input.providerRecordId}@example.org>`,
      providerThreadId: `thread:${input.providerRecordId}`,
    },
    direction: input.direction,
    notes: null,
  };
}

function buildUserRecord(id: string, email: string) {
  const timestamp = new Date("2026-07-23T08:00:00.000Z");

  return {
    id,
    name: "Operator",
    email,
    emailVerified: timestamp,
    image: null,
    role: "operator" as const,
    deactivatedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildEnv(): NodeJS.ProcessEnv {
  return {
    SALESFORCE_LOGIN_URL: "https://login.salesforce.com",
    SALESFORCE_CLIENT_ID: "client-id",
    SALESFORCE_USERNAME: "integration@example.org",
    SALESFORCE_JWT_PRIVATE_KEY:
      "-----BEGIN RSA PRIVATE KEY-----\\nMIICXQIBAAKBgQDP7bCq9uOquTFPZugyy68GbVHdbvcphpk67bU0/1e+7umGYUAl\\njbEIoeWkSjfCIj3FtHB2jnDa5LkD6JEBDBQCYLjrAbAKmpfpPkCZXnWrxNRGhIhJ\\nZG6B9HAhcE5O6u8wR60YOhD5UuuGjO1Z28siaXVgOCLIiFzwfWNFNDKKtQIDAQAB\\nAoGAXU47RizuMzFRiGEUd57hVs/9uZFPBmppHoGHHFYtKPgLAQto/rEbrVUBOP05\\nEjvNXoe/I+R9jiyvParCTyb9XtihbShFRUZvzQ7OgEIydjOpbXcKpriuv8ht4bvK\\nHP9UMcaBtCLyK7FgYtT4OZAH2yGjj5zghqDhVDIRbXuD8u0CQQDt0Y1AlBCquDnf\\njLylzBzBnEkR6DZ74SM2WX54YQMFJCGNaoVB5l5w5a0CK3fV218Hx2G/xyDJ02Ur\\nFQLR4VS/AkEA39Mlk3mTEOYxItWuCj8Pd++m4gmI6HPPBkEY53nmB63r7aYtgBkj\\nOMHI9MyIcI7peDOjDF+hAw2joW+PJMU5iwJBALpErlENZ7x/jPy2W6+0njVa9rRq\\n3/nJTe4szGz29wmY0hrUeskx6XidvBN9/l9nchhCpyIxklHiHFRRIaNHzTsCQDsD\\nEZIraKH4/xV/Hw7mh26IyggomWcoOXodqbJGCmcV7PFQcginGAk71n7sekCq/VVK\\nz/9QK0SB0RWcMzJvqXcCQQDNBQy2qypcy61+RP8VS2IfwBN10fO654aCyJwF5pQB\\nYWDzPHVMGLeYUAZEJl3wRkeXZOf6S8Lzjox0/ud6TbP9\\n-----END RSA PRIVATE KEY-----",
    SALESFORCE_API_VERSION: "61.0",
  };
}

function buildSalesforceFetchStub() {
  const state = {
    duplicateMerged: false,
    soapMergeCalls: 0,
    tokenCalls: 0,
    queryCalls: 0,
  };

  const resolveFetchUrl = (input: RequestInfo | URL): string => {
    if (typeof input === "string") {
      return input;
    }

    if (input instanceof URL) {
      return input.toString();
    }

    return input.url;
  };

  const readRequestBody = (body: BodyInit | null | undefined): string => {
    if (typeof body === "string") {
      return body;
    }

    if (body instanceof URLSearchParams) {
      return body.toString();
    }

    throw new Error("Unexpected non-text request body in Salesforce fetch stub.");
  };

  const fetchImplementation: typeof fetch = (input, init) => {
    const url = resolveFetchUrl(input);

    if (url === "https://login.salesforce.com/services/oauth2/token") {
      state.tokenCalls += 1;

      return Promise.resolve(new Response(
        JSON.stringify({
          access_token: "sf-access-token",
          instance_url: "https://example.my.salesforce.com",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ));
    }

    if (url.startsWith("https://example.my.salesforce.com/services/data/v61.0/queryAll")) {
      state.queryCalls += 1;

      return Promise.resolve(new Response(
        JSON.stringify({
          records: [
            {
              Id: MASTER_SF_ID,
              Name: "Master Contact",
              Email: "volunteer@example.org",
              IsDeleted: false,
              MasterRecordId: null,
            },
            {
              Id: DUPLICATE_SF_ID,
              Name: "Duplicate Contact",
              Email: "volunteer@example.org",
              IsDeleted: state.duplicateMerged,
              MasterRecordId: state.duplicateMerged ? MASTER_SF_ID : null,
            },
          ],
          done: true,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ));
    }

    if (url === "https://example.my.salesforce.com/services/Soap/u/61.0") {
      state.soapMergeCalls += 1;
      const requestBody = readRequestBody(init?.body);

      expect(requestBody).toContain(`<n1:Id>${MASTER_SF_ID}</n1:Id>`);
      expect(requestBody).toContain(
        `<n1:recordToMergeIds>${DUPLICATE_SF_ID}</n1:recordToMergeIds>`,
      );

      state.duplicateMerged = true;

      return Promise.resolve(new Response(
        `
          <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
            <soapenv:Body>
              <mergeResponse xmlns="urn:partner.soap.sforce.com">
                <result>
                  <id>${MASTER_SF_ID}</id>
                  <success>true</success>
                </result>
              </mergeResponse>
            </soapenv:Body>
          </soapenv:Envelope>
        `,
        {
          status: 200,
          headers: {
            "content-type": "text/xml",
          },
        },
      ));
    }

    return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
  };

  return {
    fetchImplementation,
    state,
  };
}

async function selectRows<TRow extends readonly object[]>(
  context: WorkerContext,
  query: ReturnType<typeof sql<unknown>>,
): Promise<TRow> {
  const result = await context.db.execute(query);
  return Array.isArray(result)
    ? (result as unknown as TRow)
    : (result as { readonly rows: TRow }).rows;
}

async function selectCountValue(
  context: WorkerContext,
  query: ReturnType<typeof sql<unknown>>,
): Promise<number> {
  const [row] = await selectRows<readonly CountRow[]>(context, query);
  return row === undefined ? 0 : Number(row.value);
}

async function countConsentRecordsForMasterAndDuplicate(
  context: WorkerContext,
): Promise<number> {
  return selectCountValue(
    context,
    sql`
      select count(*)::int as value
      from consent_records
      where contact_id = ${MASTER_LOCAL_ID}
         or contact_id = ${DUPLICATE_LOCAL_ID}
    `,
  );
}

async function countContactConsentForMasterAndDuplicate(
  context: WorkerContext,
): Promise<number> {
  return selectCountValue(
    context,
    sql`
      select count(*)::int as value
      from contact_consent
      where contact_id = ${MASTER_LOCAL_ID}
         or contact_id = ${DUPLICATE_LOCAL_ID}
    `,
  );
}

async function seedContact(
  context: WorkerContext,
  input: {
    readonly id: string;
    readonly salesforceContactId: string;
    readonly displayName: string;
  },
): Promise<void> {
  await context.repositories.contacts.upsert({
    id: input.id,
    salesforceContactId: input.salesforceContactId,
    displayName: input.displayName,
    primaryEmail: "volunteer@example.org",
    primaryPhone: null,
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
  });
}

async function seedSourceEvidence(
  context: WorkerContext,
  input: {
    readonly id: string;
    readonly providerRecordId: string;
    readonly occurredAt: string;
  },
): Promise<void> {
  await context.repositories.sourceEvidence.append({
    id: input.id,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.providerRecordId,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `gmail://message/${input.providerRecordId}`,
    idempotencyKey: input.id,
    checksum: `checksum:${input.providerRecordId}`,
  });
}

async function seedCanonicalEvent(
  context: WorkerContext,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly eventType:
      | "communication.email.inbound"
      | "communication.email.outbound";
    readonly occurredAt: string;
    readonly sourceEvidenceId: string;
    readonly providerRecordId: string;
    readonly direction: "inbound" | "outbound";
  },
): Promise<void> {
  await context.repositories.canonicalEvents.upsert({
    id: input.id,
    contactId: input.contactId,
    eventType: input.eventType,
    channel: "email",
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId: input.sourceEvidenceId,
    idempotencyKey: input.id,
    provenance: buildCanonicalProvenance({
      sourceEvidenceId: input.sourceEvidenceId,
      providerRecordId: input.providerRecordId,
      direction: input.direction,
    }),
    reviewState: "clear",
  });
}

async function seedTimelineProjection(
  context: WorkerContext,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly canonicalEventId: string;
    readonly occurredAt: string;
    readonly eventType:
      | "communication.email.inbound"
      | "communication.email.outbound";
    readonly summary: string;
  },
): Promise<void> {
  await context.db.insert(contactTimelineProjection).values({
    id: input.id,
    contactId: input.contactId,
    canonicalEventId: input.canonicalEventId,
    occurredAt: new Date(input.occurredAt),
    sortKey: `${input.occurredAt}#${input.canonicalEventId}`,
    eventType: input.eventType,
    summary: input.summary,
    channel: "email",
    primaryProvider: "gmail",
    reviewState: "clear",
  });
}

async function seedScenario(context: WorkerContext): Promise<void> {
  await context.settings.users.upsert(
    buildUserRecord("user:operator", "operator@example.org"),
  );

  await seedContact(context, {
    id: MASTER_LOCAL_ID,
    salesforceContactId: MASTER_SF_ID,
    displayName: "Master Contact",
  });
  await seedContact(context, {
    id: DUPLICATE_LOCAL_ID,
    salesforceContactId: DUPLICATE_SF_ID,
    displayName: "Duplicate Contact",
  });

  await Promise.all([
    seedSourceEvidence(context, {
      id: "source-evidence:duplicate-old",
      providerRecordId: "duplicate-old",
      occurredAt: "2026-07-01T09:00:00.000Z",
    }),
    seedSourceEvidence(context, {
      id: "source-evidence:master-inbound",
      providerRecordId: "master-inbound",
      occurredAt: "2026-07-10T10:00:00.000Z",
    }),
    seedSourceEvidence(context, {
      id: "source-evidence:master-reply",
      providerRecordId: "master-reply",
      occurredAt: "2026-07-10T10:05:00.000Z",
    }),
    seedSourceEvidence(context, {
      id: "source-evidence:identity-case-1",
      providerRecordId: "identity-case-1",
      occurredAt: "2026-07-11T11:00:00.000Z",
    }),
    seedSourceEvidence(context, {
      id: "source-evidence:identity-case-2",
      providerRecordId: "identity-case-2",
      occurredAt: "2026-07-11T11:05:00.000Z",
    }),
    seedSourceEvidence(context, {
      id: "source-evidence:routing-case",
      providerRecordId: "routing-case",
      occurredAt: "2026-07-11T12:00:00.000Z",
    }),
  ]);

  await Promise.all([
    seedCanonicalEvent(context, {
      id: "canonical-event:duplicate-old",
      contactId: DUPLICATE_LOCAL_ID,
      eventType: "communication.email.inbound",
      occurredAt: "2026-07-01T09:00:00.000Z",
      sourceEvidenceId: "source-evidence:duplicate-old",
      providerRecordId: "duplicate-old",
      direction: "inbound",
    }),
    seedCanonicalEvent(context, {
      id: "canonical-event:master-inbound",
      contactId: MASTER_LOCAL_ID,
      eventType: "communication.email.inbound",
      occurredAt: "2026-07-10T10:00:00.000Z",
      sourceEvidenceId: "source-evidence:master-inbound",
      providerRecordId: "master-inbound",
      direction: "inbound",
    }),
    seedCanonicalEvent(context, {
      id: "canonical-event:master-reply",
      contactId: MASTER_LOCAL_ID,
      eventType: "communication.email.outbound",
      occurredAt: "2026-07-10T10:05:00.000Z",
      sourceEvidenceId: "source-evidence:master-reply",
      providerRecordId: "master-reply",
      direction: "outbound",
    }),
  ]);

  await Promise.all([
    seedTimelineProjection(context, {
      id: "timeline:duplicate-old",
      contactId: DUPLICATE_LOCAL_ID,
      canonicalEventId: "canonical-event:duplicate-old",
      occurredAt: "2026-07-01T09:00:00.000Z",
      eventType: "communication.email.inbound",
      summary: "Old inbound from duplicate",
    }),
    seedTimelineProjection(context, {
      id: "timeline:master-inbound",
      contactId: MASTER_LOCAL_ID,
      canonicalEventId: "canonical-event:master-inbound",
      occurredAt: "2026-07-10T10:00:00.000Z",
      eventType: "communication.email.inbound",
      summary: "Newer inbound on master",
    }),
    seedTimelineProjection(context, {
      id: "timeline:master-reply",
      contactId: MASTER_LOCAL_ID,
      canonicalEventId: "canonical-event:master-reply",
      occurredAt: "2026-07-10T10:05:00.000Z",
      eventType: "communication.email.outbound",
      summary: "Master reply",
    }),
  ]);

  await context.repositories.projectDimensions.upsert({
    projectId: "project:alpha",
    projectName: "Project Alpha",
    source: "salesforce",
  });
  await context.repositories.projectDimensions.upsert({
    projectId: "project:beta",
    projectName: "Project Beta",
    source: "salesforce",
  });
  await context.db.insert(campaignRuns).values([
    {
      id: CAMPAIGN_RUN_ALPHA_ID,
      kind: "project",
      launchType: "normal_email",
      state: "draft",
      projectId: "project:alpha",
    },
    {
      id: CAMPAIGN_RUN_BETA_ID,
      kind: "project",
      launchType: "normal_email",
      state: "draft",
      projectId: "project:beta",
    },
  ]);

  await Promise.all([
    context.repositories.contactMemberships.upsert({
      id: "membership:master:alpha",
      contactId: MASTER_LOCAL_ID,
      projectId: "project:alpha",
      expeditionId: null,
      salesforceMembershipId: "a1500000000000AAA",
      role: "volunteer",
      status: "active",
      source: "salesforce",
      createdAt: "2026-07-01T08:05:00.000Z",
    }),
    context.repositories.contactMemberships.upsert({
      id: "membership:duplicate:alpha",
      contactId: DUPLICATE_LOCAL_ID,
      projectId: "project:alpha",
      expeditionId: null,
      salesforceMembershipId: "a1500000000000AAB",
      role: "volunteer",
      status: "active",
      source: "salesforce",
      createdAt: "2026-07-01T08:06:00.000Z",
    }),
    context.repositories.contactMemberships.upsert({
      id: "membership:duplicate:beta",
      contactId: DUPLICATE_LOCAL_ID,
      projectId: "project:beta",
      expeditionId: null,
      salesforceMembershipId: "a1500000000000AAC",
      role: "volunteer",
      status: "active",
      source: "salesforce",
      createdAt: "2026-07-01T08:07:00.000Z",
    }),
  ]);

  await Promise.all([
    context.repositories.contactIdentities.upsert({
      id: "identity:master:email",
      contactId: MASTER_LOCAL_ID,
      kind: "email",
      normalizedValue: "volunteer@example.org",
      isPrimary: true,
      source: "salesforce",
      verifiedAt: "2026-07-01T08:00:00.000Z",
    }),
    context.repositories.contactIdentities.upsert({
      id: "identity:duplicate:email",
      contactId: DUPLICATE_LOCAL_ID,
      kind: "email",
      normalizedValue: "volunteer@example.org",
      isPrimary: true,
      source: "salesforce",
      verifiedAt: "2026-07-01T08:00:00.000Z",
    }),
    context.repositories.contactIdentities.upsert({
      id: "identity:duplicate:phone",
      contactId: DUPLICATE_LOCAL_ID,
      kind: "phone",
      normalizedValue: "+14065550199",
      isPrimary: true,
      source: "salesforce",
      verifiedAt: "2026-07-01T08:00:00.000Z",
    }),
  ]);
  await context.db.insert(consentRecords).values([
    {
      id: "consent-record:master",
      contactId: MASTER_LOCAL_ID,
      phoneE164: "+14065550199",
      status: "opted_in",
      source: "operator_attestation",
      sourceDetail: "master consent",
      consentedAt: new Date("2026-07-02T08:00:00.000Z"),
      revokedAt: null,
      recordedByUserId: "user:operator",
      notes: "Master consent history",
      createdAt: new Date("2026-07-02T08:00:00.000Z"),
      updatedAt: new Date("2026-07-02T08:00:00.000Z"),
    },
    {
      id: "consent-record:duplicate",
      contactId: DUPLICATE_LOCAL_ID,
      phoneE164: "+14065550199",
      status: "opted_in",
      source: "sms_reply_yes",
      sourceDetail: "duplicate consent",
      consentedAt: new Date("2026-07-03T08:00:00.000Z"),
      revokedAt: null,
      recordedByUserId: "user:operator",
      notes: "Duplicate consent history",
      createdAt: new Date("2026-07-03T08:00:00.000Z"),
      updatedAt: new Date("2026-07-03T08:00:00.000Z"),
    },
  ]);
  await context.db.insert(contactConsent).values([
    {
      id: "contact-consent:master:newsletter",
      contactId: MASTER_LOCAL_ID,
      scopeType: "newsletter",
      scopeId: null,
      source: "admin_action",
      sourceRunId: CAMPAIGN_RUN_ALPHA_ID,
      optedOutAt: new Date("2026-07-09T09:00:00.000Z"),
      createdAt: new Date("2026-07-09T09:00:00.000Z"),
    },
    {
      id: "contact-consent:duplicate:newsletter",
      contactId: DUPLICATE_LOCAL_ID,
      scopeType: "newsletter",
      scopeId: null,
      source: "provider_event",
      sourceRunId: CAMPAIGN_RUN_BETA_ID,
      optedOutAt: new Date("2026-07-10T09:00:00.000Z"),
      createdAt: new Date("2026-07-10T09:00:00.000Z"),
    },
    {
      id: "contact-consent:duplicate:project-beta",
      contactId: DUPLICATE_LOCAL_ID,
      scopeType: "project",
      scopeId: "project:beta",
      source: "recipient_click",
      sourceRunId: CAMPAIGN_RUN_BETA_ID,
      optedOutAt: new Date("2026-07-11T09:00:00.000Z"),
      createdAt: new Date("2026-07-11T09:00:00.000Z"),
    },
  ]);

  await context.repositories.internalNotes.create({
    id: "note:duplicate",
    contactId: DUPLICATE_LOCAL_ID,
    body: "Internal note on duplicate",
    authorId: "user:operator",
  });
  await context.db.insert(composerDrafts).values({
    id: COMPOSER_DRAFT_ID,
    actorId: "user:operator",
    paneMode: "new_draft",
    channel: "email",
    recipientAnchorKind: "contact",
    recipientContactId: DUPLICATE_LOCAL_ID,
    recipientEmail: "volunteer@example.org",
    recipientPhone: null,
    subject: "Follow-up draft",
    bodyPlaintext: "Draft body",
    bodyHtml: "<p>Draft body</p>",
    selectedAlias: "alpha@adventurescientists.org",
    cc: [],
    bcc: [],
    attachments: [],
    aiDirective: "",
    replyContextThreadCursor: null,
    forwardContext: null,
  });

  await context.repositories.identityResolutionQueue.upsert({
    id: "identity-case:anchor-mismatch",
    sourceEvidenceId: "source-evidence:identity-case-1",
    candidateContactIds: [MASTER_LOCAL_ID],
    reasonCode: "identity_anchor_mismatch",
    status: "open",
    openedAt: "2026-07-11T11:00:00.000Z",
    resolvedAt: null,
    normalizedIdentityValues: ["volunteer@example.org"],
    anchoredContactId: DUPLICATE_LOCAL_ID,
    explanation: "Anchor mismatch before merge.",
  });
  await context.repositories.identityResolutionQueue.upsert({
    id: "identity-case:multi-candidate",
    sourceEvidenceId: "source-evidence:identity-case-2",
    candidateContactIds: [DUPLICATE_LOCAL_ID, MASTER_LOCAL_ID],
    reasonCode: "identity_multi_candidate",
    status: "open",
    openedAt: "2026-07-11T11:05:00.000Z",
    resolvedAt: null,
    normalizedIdentityValues: ["volunteer@example.org"],
    anchoredContactId: null,
    explanation: "Multiple candidates before merge.",
  });

  await context.repositories.routingReviewQueue.upsert({
    id: "routing-case:resolved",
    contactId: DUPLICATE_LOCAL_ID,
    sourceEvidenceId: "source-evidence:routing-case",
    reasonCode: "routing_missing_membership",
    status: "resolved",
    openedAt: "2026-07-11T12:00:00.000Z",
    resolvedAt: "2026-07-11T12:05:00.000Z",
    candidateMembershipIds: [],
    explanation: "Already resolved before merge.",
  });

  await Promise.all([
    context.repositories.canonicalEventAudience.upsert({
      canonicalEventId: "canonical-event:duplicate-old",
      contactId: DUPLICATE_LOCAL_ID,
      participantRole: "direct_recipient",
      normalizedEmail: "volunteer@example.org",
    }),
    context.repositories.canonicalEventAudience.upsert({
      canonicalEventId: "canonical-event:master-reply",
      contactId: DUPLICATE_LOCAL_ID,
      participantRole: "cc",
      normalizedEmail: "volunteer@example.org",
    }),
    context.repositories.canonicalEventAudience.upsert({
      canonicalEventId: "canonical-event:master-reply",
      contactId: MASTER_LOCAL_ID,
      participantRole: "direct_recipient",
      normalizedEmail: "volunteer@example.org",
    }),
  ]);
  await context.db.insert(audienceSnapshots).values([
    {
      id: "audience-snapshot:master:alpha",
      campaignRunId: CAMPAIGN_RUN_ALPHA_ID,
      contactId: MASTER_LOCAL_ID,
      newsletterSubscriberId: null,
      frozenEmail: "volunteer@example.org",
      frozenFirstName: "Master",
      frozenProjectName: "Project Alpha",
      frozenProjectId: "project:alpha",
      frozenAliasEmail: "alpha@adventurescientists.org",
      unsubscribeToken: "token-master-alpha",
      subjectVariant: null,
      deliveryStatus: "pending",
      providerMessageId: "provider-message-master-alpha",
    },
    {
      id: "audience-snapshot:duplicate:alpha",
      campaignRunId: CAMPAIGN_RUN_ALPHA_ID,
      contactId: DUPLICATE_LOCAL_ID,
      newsletterSubscriberId: null,
      frozenEmail: "volunteer@example.org",
      frozenFirstName: "Duplicate",
      frozenProjectName: "Project Alpha",
      frozenProjectId: "project:alpha",
      frozenAliasEmail: "alpha@adventurescientists.org",
      unsubscribeToken: "token-duplicate-alpha",
      subjectVariant: "a",
      deliveryStatus: "pending",
      providerMessageId: "provider-message-duplicate-alpha",
    },
    {
      id: "audience-snapshot:duplicate:beta",
      campaignRunId: CAMPAIGN_RUN_BETA_ID,
      contactId: DUPLICATE_LOCAL_ID,
      newsletterSubscriberId: null,
      frozenEmail: "volunteer@example.org",
      frozenFirstName: "Duplicate",
      frozenProjectName: "Project Beta",
      frozenProjectId: "project:beta",
      frozenAliasEmail: "beta@adventurescientists.org",
      unsubscribeToken: "token-duplicate-beta",
      subjectVariant: "b",
      deliveryStatus: "sent",
      providerMessageId: "provider-message-duplicate-beta",
    },
  ]);

  await context.db.insert(smsSenders).values({
    id: "sms-sender:primary",
    phoneE164: "+14065550000",
    displayName: "Primary SMS Sender",
  });
  await context.repositories.smsMessages.insert({
    id: "sms-message:duplicate",
    twilioMessageSid: null,
    direction: "outbound",
    contactId: DUPLICATE_LOCAL_ID,
    phoneE164: "+14065550199",
    senderId: "sms-sender:primary",
    broadcastRunId: null,
    body: "SMS linked to duplicate contact",
    segments: 1,
    encoding: "GSM-7",
    mediaUrls: null,
    sendStatus: "queued",
    failedReason: null,
    failedDetail: null,
    sentAt: null,
    receivedAt: null,
    actorId: null,
    createdAt: new Date("2026-07-12T09:00:00.000Z"),
    updatedAt: new Date("2026-07-12T09:00:00.000Z"),
  });

  await context.repositories.pendingOutbounds.insert({
    id: "pending-outbound:duplicate",
    fingerprint: "pending-outbound-fingerprint",
    actorId: "user:operator",
    canonicalContactId: DUPLICATE_LOCAL_ID,
    projectId: "project:alpha",
    fromAlias: "alpha@adventurescientists.org",
    toEmailNormalized: "volunteer@example.org",
    subject: "Pending outbound",
    bodyPlaintext: "Pending outbound body",
    bodyHtml: "<p>Pending outbound body</p>",
    bodySha256: "sha256:pending-outbound",
    attachmentMetadata: [],
    gmailThreadId: null,
    inReplyToRfc822: null,
    attemptedAt: "2026-07-12T10:00:00.000Z",
  });

  await Promise.all([
    context.repositories.inboxProjection.upsert({
      contactId: MASTER_LOCAL_ID,
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: true,
      lastInboundAt: "2026-07-10T10:00:00.000Z",
      lastOutboundAt: "2026-07-10T10:05:00.000Z",
      lastActivityAt: "2026-07-10T10:05:00.000Z",
      snippet: "Master projection",
      archivedAt: null,
      lastCanonicalEventId: "canonical-event:master-reply",
      lastEventType: "communication.email.outbound",
    }),
    context.repositories.inboxProjection.upsert({
      contactId: DUPLICATE_LOCAL_ID,
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-07-01T09:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-07-01T09:00:00.000Z",
      snippet: "Duplicate projection",
      archivedAt: null,
      lastCanonicalEventId: "canonical-event:duplicate-old",
      lastEventType: "communication.email.inbound",
    }),
  ]);
}

describe("merge-sf-contact-pair", () => {
  it("dry-run reports the full repoint plan and writes nothing", async () => {
    const context = await createTestStage1Context();
    const fetchStub = buildSalesforceFetchStub();
    const logger = createLogger();

    try {
      await seedScenario(context);

      const result = await mergeSfContactPair({
        db: context.db,
        args: [`--master=${MASTER_SF_ID}`, `--duplicate=${DUPLICATE_SF_ID}`],
        env: buildEnv(),
        logger: logger.logger,
        fetchImplementation: fetchStub.fetchImplementation,
        now: () => new Date(NOW),
      });

      expect(result.dryRun).toBe(true);
      expect(result.salesforceMergeStatus).toBe("planned");
      expect(result.platformCounts).toEqual({
        canonicalEventLedger: 1,
        contactTimelineProjection: 1,
        internalNotes: 1,
        routingReviewQueue: 1,
        identityResolutionQueueRepointed: 2,
        identityResolutionQueueToResolve: 2,
        canonicalEventAudienceDeleted: 1,
        canonicalEventAudienceRepointed: 1,
        contactIdentitiesDeleted: 1,
        contactIdentitiesRepointed: 1,
        contactMembershipsDeleted: 1,
        contactMembershipsRepointed: 1,
        consentRecords: 1,
        contactConsentDeleted: 1,
        contactConsentRepointed: 1,
        audienceSnapshotsDeleted: 1,
        audienceSnapshotsRepointed: 1,
        smsMessages: 1,
        composerDrafts: 1,
        pendingComposerOutbounds: 1,
        contactInboxProjectionDeleted: 1,
        contactsDeleted: 1,
      });
      expect(fetchStub.state.soapMergeCalls).toBe(0);

      await expect(
        context.repositories.contacts.findById(DUPLICATE_LOCAL_ID),
      ).resolves.not.toBeNull();
      await expect(
        selectRows<
          readonly {
            readonly contactId: string;
          }[]
        >(
          context,
          sql`
            select contact_id as "contactId"
            from canonical_event_ledger
            where id = 'canonical-event:duplicate-old'
          `,
        ),
      ).resolves.toEqual([{ contactId: DUPLICATE_LOCAL_ID }]);
      await expect(
        context.repositories.contactMemberships.listByContactId(DUPLICATE_LOCAL_ID),
      ).resolves.toHaveLength(2);
      await expect(
        context.repositories.identityResolutionQueue.findById(
          "identity-case:anchor-mismatch",
        ),
      ).resolves.toMatchObject({
        status: "open",
        anchoredContactId: DUPLICATE_LOCAL_ID,
      });
      await expect(
        context.repositories.inboxProjection.findByContactId(DUPLICATE_LOCAL_ID),
      ).resolves.toMatchObject({
        contactId: DUPLICATE_LOCAL_ID,
        lastCanonicalEventId: "canonical-event:duplicate-old",
      });
      await expect(
        selectRows<
          readonly {
            readonly contactId: string | null;
          }[]
        >(
          context,
          sql`
            select contact_id as "contactId"
            from consent_records
            where id = 'consent-record:duplicate'
          `,
        ),
      ).resolves.toEqual([{ contactId: DUPLICATE_LOCAL_ID }]);
      await expect(
        selectRows<
          readonly {
            readonly recipientContactId: string | null;
          }[]
        >(
          context,
          sql`
            select recipient_contact_id as "recipientContactId"
            from composer_drafts
            where id = '00000000-0000-4000-8000-000000000111'
          `,
        ),
      ).resolves.toEqual([{ recipientContactId: DUPLICATE_LOCAL_ID }]);
    } finally {
      await context.dispose();
    }
  });

  it("executes the Salesforce merge, repoints platform rows, resolves identity cases, and preserves the Opened bucket for old inbound history", async () => {
    const context = await createTestStage1Context();
    const fetchStub = buildSalesforceFetchStub();
    const logger = createLogger();

    try {
      await seedScenario(context);
      const consentRecordsBefore =
        await countConsentRecordsForMasterAndDuplicate(context);
      const contactConsentBefore =
        await countContactConsentForMasterAndDuplicate(context);

      expect(consentRecordsBefore).toBe(2);
      expect(contactConsentBefore).toBe(3);

      const result = await mergeSfContactPair({
        db: context.db,
        args: [
          `--master=${MASTER_SF_ID}`,
          `--duplicate=${DUPLICATE_SF_ID}`,
          "--execute",
        ],
        env: buildEnv(),
        logger: logger.logger,
        fetchImplementation: fetchStub.fetchImplementation,
        now: () => new Date(NOW),
      });

      expect(result.dryRun).toBe(false);
      expect(result.salesforceMergeStatus).toBe("merged");
      expect(result.identityCasesResolved).toBe(2);
      expect(fetchStub.state.soapMergeCalls).toBe(1);

      await expect(
        selectRows<
          readonly {
            readonly contactId: string;
          }[]
        >(
          context,
          sql`
            select contact_id as "contactId"
            from canonical_event_ledger
            where id = 'canonical-event:duplicate-old'
          `,
        ),
      ).resolves.toEqual([{ contactId: MASTER_LOCAL_ID }]);
      await expect(
        selectRows<
          readonly {
            readonly contactId: string;
          }[]
        >(
          context,
          sql`
            select contact_id as "contactId"
            from contact_timeline_projection
            where id = 'timeline:duplicate-old'
          `,
        ),
      ).resolves.toEqual([{ contactId: MASTER_LOCAL_ID }]);
      await expect(
        context.repositories.internalNotes.findByContactId(MASTER_LOCAL_ID),
      ).resolves.toHaveLength(1);
      await expect(
        context.repositories.routingReviewQueue.findById("routing-case:resolved"),
      ).resolves.toMatchObject({
        contactId: MASTER_LOCAL_ID,
      });

      const resolvedCases = await Promise.all([
        context.repositories.identityResolutionQueue.findById(
          "identity-case:anchor-mismatch",
        ),
        context.repositories.identityResolutionQueue.findById(
          "identity-case:multi-candidate",
        ),
      ]);

      expect(resolvedCases[0]).toMatchObject({
        status: "resolved",
        anchoredContactId: MASTER_LOCAL_ID,
        candidateContactIds: [MASTER_LOCAL_ID],
      });
      expect(resolvedCases[1]).toMatchObject({
        status: "resolved",
        anchoredContactId: null,
        candidateContactIds: [MASTER_LOCAL_ID],
      });
      expect(resolvedCases[0]?.explanation).toContain(
        `merged Salesforce duplicate contact ${DUPLICATE_SF_ID} into ${MASTER_SF_ID} (ops merge-sf-contact-pair 2026-07-23)`,
      );

      await expect(
        selectRows<
          readonly {
            readonly canonicalEventId: string;
            readonly contactId: string;
            readonly participantRole: string;
          }[]
        >(
          context,
          sql`
            select
              canonical_event_id as "canonicalEventId",
              contact_id as "contactId",
              participant_role as "participantRole"
            from canonical_event_audience
            order by canonical_event_id, contact_id
          `,
        ),
      ).resolves.toEqual([
        {
          canonicalEventId: "canonical-event:duplicate-old",
          contactId: MASTER_LOCAL_ID,
          participantRole: "direct_recipient",
        },
        {
          canonicalEventId: "canonical-event:master-reply",
          contactId: MASTER_LOCAL_ID,
          participantRole: "direct_recipient",
        },
      ]);

      const identities =
        await context.repositories.contactIdentities.listByContactId(MASTER_LOCAL_ID);
      expect(identities.map((identity) => identity.normalizedValue).sort()).toEqual(
        ["+14065550199", "volunteer@example.org"],
      );

      const memberships =
        await context.repositories.contactMemberships.listByContactId(MASTER_LOCAL_ID);
      expect(memberships.map((membership) => membership.projectId)).toEqual([
        "project:alpha",
        "project:beta",
      ]);
      expect(
        await countConsentRecordsForMasterAndDuplicate(context),
      ).toBe(consentRecordsBefore);
      expect(
        await countContactConsentForMasterAndDuplicate(context),
      ).toBe(contactConsentBefore - result.platformCounts.contactConsentDeleted);
      await expect(
        selectRows<
          readonly {
            readonly id: string;
            readonly contactId: string | null;
            readonly source: string;
          }[]
        >(
          context,
          sql`
            select
              id,
              contact_id as "contactId",
              source
            from consent_records
            order by id
          `,
        ),
      ).resolves.toEqual([
        {
          id: "consent-record:duplicate",
          contactId: MASTER_LOCAL_ID,
          source: "sms_reply_yes",
        },
        {
          id: "consent-record:master",
          contactId: MASTER_LOCAL_ID,
          source: "operator_attestation",
        },
      ]);
      await expect(
        selectRows<
          readonly {
            readonly id: string;
            readonly contactId: string;
            readonly scopeType: string;
            readonly scopeId: string | null;
            readonly source: string;
          }[]
        >(
          context,
          sql`
            select
              id,
              contact_id as "contactId",
              scope_type as "scopeType",
              scope_id as "scopeId",
              source
            from contact_consent
            order by id
          `,
        ),
      ).resolves.toEqual([
        {
          id: "contact-consent:duplicate:project-beta",
          contactId: MASTER_LOCAL_ID,
          scopeType: "project",
          scopeId: "project:beta",
          source: "recipient_click",
        },
        {
          id: "contact-consent:master:newsletter",
          contactId: MASTER_LOCAL_ID,
          scopeType: "newsletter",
          scopeId: null,
          source: "admin_action",
        },
      ]);
      await expect(
        selectRows<
          readonly {
            readonly id: string;
            readonly campaignRunId: string;
            readonly contactId: string | null;
          }[]
        >(
          context,
          sql`
            select
              id,
              campaign_run_id as "campaignRunId",
              contact_id as "contactId"
            from audience_snapshots
            order by id
          `,
        ),
      ).resolves.toEqual([
        {
          id: "audience-snapshot:duplicate:beta",
          campaignRunId: CAMPAIGN_RUN_BETA_ID,
          contactId: MASTER_LOCAL_ID,
        },
        {
          id: "audience-snapshot:master:alpha",
          campaignRunId: CAMPAIGN_RUN_ALPHA_ID,
          contactId: MASTER_LOCAL_ID,
        },
      ]);
      await expect(
        selectRows<
          readonly {
            readonly recipientContactId: string | null;
          }[]
        >(
          context,
          sql`
            select recipient_contact_id as "recipientContactId"
            from composer_drafts
            where id = '00000000-0000-4000-8000-000000000111'
          `,
        ),
      ).resolves.toEqual([{ recipientContactId: MASTER_LOCAL_ID }]);

      await expect(
        context.repositories.smsMessages.listByContact(MASTER_LOCAL_ID, 10),
      ).resolves.toHaveLength(1);
      await expect(
        context.repositories.pendingOutbounds.findForContact(MASTER_LOCAL_ID, {
          limit: 10,
        }),
      ).resolves.toHaveLength(1);
      await expect(
        context.repositories.inboxProjection.findByContactId(DUPLICATE_LOCAL_ID),
      ).resolves.toBeNull();
      await expect(
        context.repositories.contacts.findById(DUPLICATE_LOCAL_ID),
      ).resolves.toBeNull();
      await expect(
        context.repositories.inboxProjection.findByContactId(MASTER_LOCAL_ID),
      ).resolves.toMatchObject({
        contactId: MASTER_LOCAL_ID,
        bucket: "Opened",
        hasUnresolved: false,
        lastInboundAt: "2026-07-10T10:00:00.000Z",
        lastCanonicalEventId: "canonical-event:master-reply",
        lastEventType: "communication.email.outbound",
      });
    } finally {
      await context.dispose();
    }
  });

  it("is idempotent across repeated execute runs", async () => {
    const context = await createTestStage1Context();
    const fetchStub = buildSalesforceFetchStub();
    const logger = createLogger();

    try {
      await seedScenario(context);

      await mergeSfContactPair({
        db: context.db,
        args: [
          `--master=${MASTER_SF_ID}`,
          `--duplicate=${DUPLICATE_SF_ID}`,
          "--execute",
        ],
        env: buildEnv(),
        logger: logger.logger,
        fetchImplementation: fetchStub.fetchImplementation,
        now: () => new Date(NOW),
      });

      const secondResult = await mergeSfContactPair({
        db: context.db,
        args: [
          `--master=${MASTER_SF_ID}`,
          `--duplicate=${DUPLICATE_SF_ID}`,
          "--execute",
        ],
        env: buildEnv(),
        logger: logger.logger,
        fetchImplementation: fetchStub.fetchImplementation,
        now: () => new Date(NOW),
      });

      expect(secondResult.salesforceMergeStatus).toBe("already_merged_to_master");
      expect(secondResult.platformCounts).toEqual({
        canonicalEventLedger: 0,
        contactTimelineProjection: 0,
        internalNotes: 0,
        routingReviewQueue: 0,
        identityResolutionQueueRepointed: 0,
        identityResolutionQueueToResolve: 0,
        canonicalEventAudienceDeleted: 0,
        canonicalEventAudienceRepointed: 0,
        contactIdentitiesDeleted: 0,
        contactIdentitiesRepointed: 0,
        contactMembershipsDeleted: 0,
        contactMembershipsRepointed: 0,
        consentRecords: 0,
        contactConsentDeleted: 0,
        contactConsentRepointed: 0,
        audienceSnapshotsDeleted: 0,
        audienceSnapshotsRepointed: 0,
        smsMessages: 0,
        composerDrafts: 0,
        pendingComposerOutbounds: 0,
        contactInboxProjectionDeleted: 0,
        contactsDeleted: 0,
      });
      expect(secondResult.identityCasesResolved).toBe(0);
      expect(secondResult.nothingToDo).toBe(true);
      expect(fetchStub.state.soapMergeCalls).toBe(1);
    } finally {
      await context.dispose();
    }
  });
});
