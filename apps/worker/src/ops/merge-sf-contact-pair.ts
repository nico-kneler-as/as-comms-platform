import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createStage1RepositoryBundle,
  type Stage1Database,
} from "@as-comms/db";
import {
  createStage1NormalizationService,
  createStage1PersistenceService,
  rebuildInboxProjectionForContact,
} from "@as-comms/domain";
import {
  createSalesforceApiClient,
  exchangeSalesforceJwtBearerAccessToken,
  type SalesforceCaptureServiceConfig,
} from "@as-comms/integrations";
import { sql as drizzleSql } from "drizzle-orm";

import {
  parseCliFlags,
  readOptionalBooleanFlag,
  readRequiredFlag,
} from "./helpers.js";
import { mergeSalesforceContactPairViaSoap } from "./salesforce-contact-merge-soap.js";

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface SqlRunner {
  unsafe<TRow extends readonly object[]>(
    label: string,
    query: string,
  ): Promise<TRow>;
}

interface CountRow {
  readonly value: number | string;
}

interface IdRow {
  readonly id: string;
}

interface LocalContactSummary {
  readonly id: string;
  readonly salesforceContactId: string | null;
  readonly displayName: string;
  readonly primaryEmail: string | null;
}

interface SalesforceContactSummary {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly isDeleted: boolean;
  readonly masterRecordId: string | null;
}

interface PlatformMutationCounts {
  readonly canonicalEventLedger: number;
  readonly contactTimelineProjection: number;
  readonly internalNotes: number;
  readonly routingReviewQueue: number;
  readonly identityResolutionQueueRepointed: number;
  readonly identityResolutionQueueToResolve: number;
  readonly canonicalEventAudienceDeleted: number;
  readonly canonicalEventAudienceRepointed: number;
  readonly contactIdentitiesDeleted: number;
  readonly contactIdentitiesRepointed: number;
  readonly contactMembershipsDeleted: number;
  readonly contactMembershipsRepointed: number;
  readonly consentRecords: number;
  readonly contactConsentDeleted: number;
  readonly contactConsentRepointed: number;
  readonly audienceSnapshotsDeleted: number;
  readonly audienceSnapshotsRepointed: number;
  readonly smsMessages: number;
  readonly composerDrafts: number;
  readonly pendingComposerOutbounds: number;
  readonly contactInboxProjectionDeleted: number;
  readonly contactsDeleted: number;
}

interface PlatformMutationResult {
  readonly counts: PlatformMutationCounts;
}

interface InboxRefreshResult {
  readonly projectionExistsAfterRefresh: boolean;
  readonly projectionChanged: boolean;
}

type SalesforceMergeStatus =
  | "planned"
  | "merged"
  | "already_merged_to_master";

type CompletedStep =
  | "salesforce_merge"
  | "platform_repoint"
  | "identity_cases_resolved"
  | "inbox_flags_refreshed";

export interface MergeSfContactPairResult {
  readonly dryRun: boolean;
  readonly masterSalesforceId: string;
  readonly duplicateSalesforceId: string;
  readonly masterLocalId: string;
  readonly duplicateLocalId: string;
  readonly salesforceMergeStatus: SalesforceMergeStatus;
  readonly masterSalesforceRecord: SalesforceContactSummary;
  readonly duplicateSalesforceRecord: SalesforceContactSummary;
  readonly masterLocalRecord: LocalContactSummary;
  readonly duplicateLocalRecord: LocalContactSummary | null;
  readonly platformCounts: PlatformMutationCounts;
  readonly identityCasesResolved: number;
  readonly inboxProjectionExistsAfterRefresh: boolean;
  readonly inboxProjectionChanged: boolean;
  readonly completedSteps: readonly CompletedStep[];
  readonly nothingToDo: boolean;
}

class DryRunRollback extends Error {
  constructor() {
    super("dry-run-rollback");
  }
}

class SqlStatementError extends Error {
  readonly label: string;
  readonly query: string;
  readonly causeData: unknown;

  constructor(input: {
    readonly label: string;
    readonly query: string;
    readonly cause: unknown;
  }) {
    super(`Postgres statement failed during ${input.label}.`);
    this.name = "SqlStatementError";
    this.label = input.label;
    this.query = input.query;
    this.causeData = input.cause;
  }
}

const SALESFORCE_CONTACT_ID_PATTERN = /^003[A-Za-z0-9]{15}$/u;

function normalizeSqlResultRows(
  result: unknown,
): readonly Record<string, unknown>[] {
  if (Array.isArray(result)) {
    return result as readonly Record<string, unknown>[];
  }

  const rows = (result as { readonly rows?: readonly Record<string, unknown>[] })
    .rows;
  return rows ?? [];
}

function createDbSqlRunner(db: Stage1Database): SqlRunner {
  return {
    async unsafe<TRow extends readonly object[]>(
      label: string,
      query: string,
    ): Promise<TRow> {
      try {
        const result = await db.execute(drizzleSql.raw(query));
        return normalizeSqlResultRows(result) as unknown as TRow;
      } catch (error) {
        throw new SqlStatementError({
          label,
          query,
          cause: error,
        });
      }
    },
  };
}

function readConnectionString(env: NodeJS.ProcessEnv): string {
  const value =
    env.WORKER_DATABASE_URL ?? env.DATABASE_URL ?? env.DATABASE_PUBLIC_URL;

  if (value === undefined || value.trim().length === 0) {
    throw new Error(
      "DATABASE_PUBLIC_URL, DATABASE_URL, or WORKER_DATABASE_URL is required for this ops command.",
    );
  }

  return value.trim();
}

function readRequiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();

  if (value === undefined || value.length === 0) {
    throw new Error(`${key} is required for merge-sf-contact-pair.`);
  }

  return value;
}

function readOptionalPositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: number,
): number {
  const value = env[key]?.trim();

  if (value === undefined || value.length === 0) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }

  return parsed;
}

function readOptionalStringEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: string,
): string {
  const value = env[key]?.trim();
  return value === undefined || value.length === 0 ? defaultValue : value;
}

function readSalesforceConfig(
  env: NodeJS.ProcessEnv,
): SalesforceCaptureServiceConfig {
  return {
    bearerToken: "unused-for-jwt-ops-merge",
    loginUrl: readRequiredEnv(env, "SALESFORCE_LOGIN_URL"),
    clientId: readRequiredEnv(env, "SALESFORCE_CLIENT_ID"),
    username: readRequiredEnv(env, "SALESFORCE_USERNAME"),
    jwtPrivateKey: readRequiredEnv(env, "SALESFORCE_JWT_PRIVATE_KEY"),
    jwtExpirationSeconds: readOptionalPositiveIntegerEnv(
      env,
      "SALESFORCE_JWT_EXPIRATION_SECONDS",
      180,
    ),
    apiVersion: readOptionalStringEnv(env, "SALESFORCE_API_VERSION", "61.0"),
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
    timeoutMs: readOptionalPositiveIntegerEnv(
      env,
      "SALESFORCE_CAPTURE_TIMEOUT_MS",
      15_000,
    ),
  };
}

function validateSalesforceContactId(label: string, value: string): string {
  const trimmed = value.trim();

  if (!SALESFORCE_CONTACT_ID_PATTERN.test(trimmed)) {
    throw new Error(
      `Flag --${label} must be an 18-character Salesforce Contact ID starting with 003.`,
    );
  }

  return trimmed;
}

function buildLocalSalesforceContactId(salesforceContactId: string): string {
  return `contact:salesforce:${salesforceContactId}`;
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteSoqlLiteral(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function buildTextArray(values: readonly string[]): string {
  return `array[${values.map((value) => quoteSqlLiteral(value)).join(", ")}]::text[]`;
}

function sqlTimestampLiteral(value: string): string {
  return `${quoteSqlLiteral(value)}::timestamptz`;
}

function readStringField(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readBooleanField(
  row: Record<string, unknown>,
  key: string,
): boolean {
  return row[key] === true;
}

function requireValue<TValue>(
  value: TValue | null | undefined,
  message: string,
): NonNullable<TValue> {
  if (value === null || value === undefined) {
    throw new Error(message);
  }

  return value as NonNullable<TValue>;
}

function buildIdentityResolutionExplanation(input: {
  readonly masterSalesforceId: string;
  readonly duplicateSalesforceId: string;
  readonly executedAt: string;
}): string {
  return `merged Salesforce duplicate contact ${input.duplicateSalesforceId} into ${input.masterSalesforceId} (ops merge-sf-contact-pair ${input.executedAt.slice(
    0,
    10,
  )})`;
}

function sumPlatformCounts(counts: PlatformMutationCounts): number {
  return (Object.keys(counts) as (keyof PlatformMutationCounts)[]).reduce(
    (total, key) => total + counts[key],
    0,
  );
}

async function updateRowsAndReturnIds(
  sql: SqlRunner,
  label: string,
  query: string,
): Promise<readonly string[]> {
  const rows = await sql.unsafe<readonly IdRow[]>(label, query);
  return rows.map((row) => row.id);
}

async function selectCount(
  sql: SqlRunner,
  label: string,
  query: string,
): Promise<number> {
  const [row] = await sql.unsafe<readonly CountRow[]>(label, query);

  if (row === undefined) {
    return 0;
  }

  return Number(row.value);
}

function buildCollapsedToMasterWhere(masterLocalId: string): string {
  const masterLiteral = quoteSqlLiteral(masterLocalId);

  return `
    (
      select coalesce(
        array_agg(contact_id order by contact_id),
        array[]::text[]
      )
      from (
        select distinct contact_id
        from unnest(
          case
            when anchored_contact_id is null then candidate_contact_ids
            else array_prepend(anchored_contact_id, candidate_contact_ids)
          end
        ) as contact_id
        where contact_id is not null
      ) collapsed_contacts
    ) = array[${masterLiteral}]::text[]
  `;
}

async function performPlatformRepoint(input: {
  readonly db: Stage1Database;
  readonly masterLocalId: string;
  readonly duplicateLocalId: string;
  readonly duplicateLocalRecordExists: boolean;
  readonly executedAt: string;
  readonly dryRun: boolean;
}): Promise<PlatformMutationResult> {
  const timestampLiteral = sqlTimestampLiteral(input.executedAt);
  const masterLocalIdLiteral = quoteSqlLiteral(input.masterLocalId);
  const duplicateLocalIdLiteral = quoteSqlLiteral(input.duplicateLocalId);
  const duplicateLocalIdArray = buildTextArray([input.duplicateLocalId]);
  let result: PlatformMutationResult | null = null;

  const runInTransaction = async (tx: Stage1Database) => {
    const sql = createDbSqlRunner(tx);
    const canonicalEventLedgerIds = await updateRowsAndReturnIds(
      sql,
      "canonical_event_ledger.repoint",
      `
        update canonical_event_ledger
        set
          contact_id = ${masterLocalIdLiteral},
          updated_at = ${timestampLiteral}
        where contact_id = ${duplicateLocalIdLiteral}
        returning id
      `,
    );
    const timelineProjectionIds = await updateRowsAndReturnIds(
      sql,
      "contact_timeline_projection.repoint",
      `
        update contact_timeline_projection
        set
          contact_id = ${masterLocalIdLiteral},
          updated_at = ${timestampLiteral}
        where contact_id = ${duplicateLocalIdLiteral}
        returning id
      `,
    );
    const internalNoteIds = await updateRowsAndReturnIds(
      sql,
      "internal_notes.repoint",
      `
        update internal_notes
        set
          contact_id = ${masterLocalIdLiteral},
          updated_at = ${timestampLiteral}
        where contact_id = ${duplicateLocalIdLiteral}
        returning id
      `,
    );
    const routingReviewQueueIds = await updateRowsAndReturnIds(
      sql,
      "routing_review_queue.repoint",
      `
        update routing_review_queue
        set
          contact_id = ${masterLocalIdLiteral},
          updated_at = ${timestampLiteral}
        where contact_id = ${duplicateLocalIdLiteral}
        returning id
      `,
    );
    const identityResolutionQueueIds = await updateRowsAndReturnIds(
      sql,
      "identity_resolution_queue.repoint",
      `
        update identity_resolution_queue
        set
          anchored_contact_id = case
            when anchored_contact_id = ${duplicateLocalIdLiteral} then ${masterLocalIdLiteral}
            else anchored_contact_id
          end,
          candidate_contact_ids = (
            select coalesce(
              array_agg(candidate_id order by candidate_id),
              array[]::text[]
            )
            from (
              select distinct candidate_id
              from unnest(
                case
                  when candidate_contact_ids && ${duplicateLocalIdArray}
                    then array_replace(
                      candidate_contact_ids,
                      ${duplicateLocalIdLiteral},
                      ${masterLocalIdLiteral}
                    )
                  else candidate_contact_ids
                end
              ) as candidate_id
              where candidate_id <> ${duplicateLocalIdLiteral}
            ) deduped_candidates
          ),
          updated_at = ${timestampLiteral}
        where anchored_contact_id = ${duplicateLocalIdLiteral}
           or candidate_contact_ids && ${duplicateLocalIdArray}
        returning id
      `,
    );
    const canonicalEventAudienceDeletedIds = await updateRowsAndReturnIds(
      sql,
      "canonical_event_audience.delete_collisions",
      `
        delete from canonical_event_audience duplicate_rows
        using canonical_event_audience master_rows
        where duplicate_rows.contact_id = ${duplicateLocalIdLiteral}
          and master_rows.contact_id = ${masterLocalIdLiteral}
          and master_rows.canonical_event_id = duplicate_rows.canonical_event_id
        returning duplicate_rows.canonical_event_id as id
      `,
    );
    const canonicalEventAudienceRepointedIds = await updateRowsAndReturnIds(
      sql,
      "canonical_event_audience.repoint",
      `
        update canonical_event_audience
        set
          contact_id = ${masterLocalIdLiteral},
          updated_at = ${timestampLiteral}
        where contact_id = ${duplicateLocalIdLiteral}
        returning canonical_event_id as id
      `,
    );
    const contactIdentityDeletedIds = await updateRowsAndReturnIds(
      sql,
      "contact_identities.delete_collisions",
      `
        delete from contact_identities duplicate_rows
        using contact_identities master_rows
        where duplicate_rows.contact_id = ${duplicateLocalIdLiteral}
          and master_rows.contact_id = ${masterLocalIdLiteral}
          and master_rows.kind = duplicate_rows.kind
          and master_rows.normalized_value = duplicate_rows.normalized_value
        returning duplicate_rows.id as id
      `,
    );
    const contactIdentityRepointedIds = await updateRowsAndReturnIds(
      sql,
      "contact_identities.repoint",
      `
        update contact_identities
        set
          contact_id = ${masterLocalIdLiteral},
          updated_at = ${timestampLiteral}
        where contact_id = ${duplicateLocalIdLiteral}
        returning id
      `,
    );
    const contactMembershipDeletedIds = await updateRowsAndReturnIds(
      sql,
      "contact_memberships.delete_project_overlaps",
      `
        delete from contact_memberships duplicate_rows
        using contact_memberships master_rows
        where duplicate_rows.contact_id = ${duplicateLocalIdLiteral}
          and duplicate_rows.project_id is not null
          and master_rows.contact_id = ${masterLocalIdLiteral}
          and master_rows.project_id = duplicate_rows.project_id
          and master_rows.salesforce_deleted_at is null
        returning duplicate_rows.id as id
      `,
    );
    const contactMembershipRepointedIds = await updateRowsAndReturnIds(
      sql,
      "contact_memberships.repoint",
      `
        update contact_memberships
        set
          contact_id = ${masterLocalIdLiteral},
          updated_at = ${timestampLiteral}
        where contact_id = ${duplicateLocalIdLiteral}
        returning id
      `,
    );
    const consentRecordIds = await updateRowsAndReturnIds(
      sql,
      "consent_records.repoint",
      `
        update consent_records
        set
          contact_id = ${masterLocalIdLiteral},
          updated_at = ${timestampLiteral}
        where contact_id = ${duplicateLocalIdLiteral}
        returning id
      `,
    );
    const contactConsentDeletedIds = await updateRowsAndReturnIds(
      sql,
      "contact_consent.delete_collisions",
      `
        delete from contact_consent duplicate_rows
        using contact_consent master_rows
        where duplicate_rows.contact_id = ${duplicateLocalIdLiteral}
          and master_rows.contact_id = ${masterLocalIdLiteral}
          and master_rows.scope_type = duplicate_rows.scope_type
          and (
            (
              duplicate_rows.scope_type = 'project'
              and master_rows.scope_id = duplicate_rows.scope_id
            )
            or duplicate_rows.scope_type in ('newsletter', 'all')
          )
        returning duplicate_rows.id as id
      `,
    );
    const contactConsentRepointedIds = await updateRowsAndReturnIds(
      sql,
      "contact_consent.repoint",
      `
        update contact_consent
        set
          contact_id = ${masterLocalIdLiteral}
        where contact_id = ${duplicateLocalIdLiteral}
        returning id
      `,
    );
    const audienceSnapshotDeletedIds = await updateRowsAndReturnIds(
      sql,
      "audience_snapshots.delete_collisions",
      `
        delete from audience_snapshots duplicate_rows
        using audience_snapshots master_rows
        where duplicate_rows.contact_id = ${duplicateLocalIdLiteral}
          and master_rows.contact_id = ${masterLocalIdLiteral}
          and master_rows.campaign_run_id = duplicate_rows.campaign_run_id
        returning duplicate_rows.id as id
      `,
    );
    const audienceSnapshotRepointedIds = await updateRowsAndReturnIds(
      sql,
      "audience_snapshots.repoint",
      `
        update audience_snapshots
        set contact_id = ${masterLocalIdLiteral}
        where contact_id = ${duplicateLocalIdLiteral}
        returning id
      `,
    );
    const smsMessageIds = await updateRowsAndReturnIds(
      sql,
      "sms_messages.repoint",
      `
        update sms_messages
        set
          contact_id = ${masterLocalIdLiteral},
          updated_at = ${timestampLiteral}
        where contact_id = ${duplicateLocalIdLiteral}
        returning id
      `,
    );
    const composerDraftIds = await updateRowsAndReturnIds(
      sql,
      "composer_drafts.repoint",
      `
        update composer_drafts
        set
          recipient_contact_id = ${masterLocalIdLiteral},
          updated_at = ${timestampLiteral}
        where recipient_contact_id = ${duplicateLocalIdLiteral}
        returning id
      `,
    );
    const pendingComposerOutboundIds = await updateRowsAndReturnIds(
      sql,
      "pending_composer_outbounds.repoint",
      `
        update pending_composer_outbounds
        set
          canonical_contact_id = ${masterLocalIdLiteral},
          updated_at = ${timestampLiteral}
        where canonical_contact_id = ${duplicateLocalIdLiteral}
        returning id
      `,
    );
    const contactInboxProjectionIds = await updateRowsAndReturnIds(
      sql,
      "contact_inbox_projection.delete_duplicate",
      `
        delete from contact_inbox_projection
        where contact_id = ${duplicateLocalIdLiteral}
        returning contact_id as id
      `,
    );
    const deletedContactIds = await updateRowsAndReturnIds(
      sql,
      "contacts.delete_duplicate",
      `
        delete from contacts
        where id = ${duplicateLocalIdLiteral}
        returning id
      `,
    );
    const identityCasesToResolve = await selectCount(
      sql,
      "identity_resolution_queue.count_collapsed_open",
      `
        select count(*)::int as value
        from identity_resolution_queue
        where status = 'open'
          and ${buildCollapsedToMasterWhere(input.masterLocalId)}
      `,
    );

    if (input.duplicateLocalRecordExists && deletedContactIds.length !== 1) {
      throw new Error(
        `Expected to delete local duplicate ${input.duplicateLocalId} exactly once; deleted ${deletedContactIds.length.toString()}.`,
      );
    }

    result = {
      counts: {
        canonicalEventLedger: canonicalEventLedgerIds.length,
        contactTimelineProjection: timelineProjectionIds.length,
        internalNotes: internalNoteIds.length,
        routingReviewQueue: routingReviewQueueIds.length,
        identityResolutionQueueRepointed: identityResolutionQueueIds.length,
        identityResolutionQueueToResolve: identityCasesToResolve,
        canonicalEventAudienceDeleted: canonicalEventAudienceDeletedIds.length,
        canonicalEventAudienceRepointed:
          canonicalEventAudienceRepointedIds.length,
        contactIdentitiesDeleted: contactIdentityDeletedIds.length,
        contactIdentitiesRepointed: contactIdentityRepointedIds.length,
        contactMembershipsDeleted: contactMembershipDeletedIds.length,
        contactMembershipsRepointed: contactMembershipRepointedIds.length,
        consentRecords: consentRecordIds.length,
        contactConsentDeleted: contactConsentDeletedIds.length,
        contactConsentRepointed: contactConsentRepointedIds.length,
        audienceSnapshotsDeleted: audienceSnapshotDeletedIds.length,
        audienceSnapshotsRepointed: audienceSnapshotRepointedIds.length,
        smsMessages: smsMessageIds.length,
        composerDrafts: composerDraftIds.length,
        pendingComposerOutbounds: pendingComposerOutboundIds.length,
        contactInboxProjectionDeleted: contactInboxProjectionIds.length,
        contactsDeleted: deletedContactIds.length,
      },
    };

    if (input.dryRun) {
      throw new DryRunRollback();
    }
  };

  if (input.dryRun) {
    try {
      await input.db.transaction(runInTransaction);
    } catch (error) {
      if (!(error instanceof DryRunRollback)) {
        throw error;
      }
    }
  } else {
    await input.db.transaction(runInTransaction);
  }

  return requireValue(
    result,
    "Expected platform repoint result to be captured.",
  );
}

async function resolveCollapsedIdentityCases(input: {
  readonly db: Stage1Database;
  readonly masterLocalId: string;
  readonly executedAt: string;
  readonly resolutionExplanation: string;
}): Promise<number> {
  const sql = createDbSqlRunner(input.db);
  const timestampLiteral = sqlTimestampLiteral(input.executedAt);
  const explanationLiteral = quoteSqlLiteral(input.resolutionExplanation);
  const resolvedIds = await updateRowsAndReturnIds(
    sql,
    "identity_resolution_queue.resolve_collapsed_open",
    `
      update identity_resolution_queue
      set
        status = 'resolved',
        resolved_at = coalesce(resolved_at, ${timestampLiteral}),
        explanation = case
          when position(${explanationLiteral} in explanation) > 0 then explanation
          else explanation || ' ' || ${explanationLiteral}
        end,
        updated_at = ${timestampLiteral}
      where status = 'open'
        and ${buildCollapsedToMasterWhere(input.masterLocalId)}
      returning id
    `,
  );

  return resolvedIds.length;
}

function serializeProjection(projection: unknown): string {
  return JSON.stringify(projection);
}

async function refreshMasterInboxState(input: {
  readonly db: Stage1Database;
  readonly masterLocalId: string;
}): Promise<InboxRefreshResult> {
  const repositories = createStage1RepositoryBundle(input.db);
  const persistence = createStage1PersistenceService(repositories);
  const normalization = createStage1NormalizationService(persistence);
  const beforeProjection = await repositories.inboxProjection.findByContactId(
    input.masterLocalId,
  );

  await rebuildInboxProjectionForContact(persistence, input.masterLocalId);
  await normalization.refreshInboxReviewOverlay({
    contactId: input.masterLocalId,
  });

  const afterProjection = await repositories.inboxProjection.findByContactId(
    input.masterLocalId,
  );

  return {
    projectionExistsAfterRefresh: afterProjection !== null,
    projectionChanged:
      serializeProjection(beforeProjection) !== serializeProjection(afterProjection),
  };
}

async function loadSalesforceContacts(input: {
  readonly config: SalesforceCaptureServiceConfig;
  readonly contactIds: readonly string[];
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => Date;
}): Promise<ReadonlyMap<string, SalesforceContactSummary>> {
  const apiClient = createSalesforceApiClient(input.config, {
    ...(input.fetchImplementation === undefined
      ? {}
      : {
          fetchImplementation: input.fetchImplementation,
        }),
    ...(input.now === undefined
      ? {}
      : {
          now: input.now,
        }),
  });
  const rows = await apiClient.queryAllIncludingDeleted(
    `select Id, Name, Email, IsDeleted, MasterRecordId from Contact where Id in (${input.contactIds
      .map((contactId) => quoteSoqlLiteral(contactId))
      .join(", ")})`,
  );
  const records = new Map<string, SalesforceContactSummary>();

  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const id = readStringField(record, "Id");

    if (id === null) {
      continue;
    }

    records.set(id, {
      id,
      name: readStringField(record, "Name"),
      email: readStringField(record, "Email"),
      isDeleted: readBooleanField(record, "IsDeleted"),
      masterRecordId: readStringField(record, "MasterRecordId"),
    });
  }

  return records;
}

async function loadLocalContact(input: {
  readonly db: Stage1Database;
  readonly localContactId: string;
}): Promise<LocalContactSummary | null> {
  const repositories = createStage1RepositoryBundle(input.db);
  const contact = await repositories.contacts.findById(input.localContactId);

  if (contact === null) {
    return null;
  }

  return {
    id: contact.id,
    salesforceContactId: contact.salesforceContactId,
    displayName: contact.displayName,
    primaryEmail: contact.primaryEmail,
  };
}

function logSqlStatementError(logger: Logger, error: SqlStatementError): void {
  logger.error(`[merge-sf-contact-pair:sql] ${error.message}`);
  logger.error(`[merge-sf-contact-pair:sql:label] ${error.label}`);
  logger.error(`[merge-sf-contact-pair:sql:query] ${error.query}`);

  if (error.causeData instanceof Error) {
    logger.error(
      `[merge-sf-contact-pair:sql:cause] ${error.causeData.message}`,
    );

    const cause = error.causeData as Error & Record<string, unknown>;
    for (const key of [
      "code",
      "detail",
      "constraint",
      "column",
      "table",
      "schema",
      "severity",
      "position",
      "where",
      "hint",
    ]) {
      if (cause[key] !== undefined) {
        logger.error(
          `[merge-sf-contact-pair:sql:${key}] ${JSON.stringify(cause[key])}`,
        );
      }
    }
  }
}

function logRecoveryNotice(input: {
  readonly logger: Logger;
  readonly masterSalesforceId: string;
  readonly duplicateSalesforceId: string;
  readonly completedSteps: readonly CompletedStep[];
}): void {
  input.logger.error("RECOVERY NOTICE: Salesforce merge already completed.");
  input.logger.error(
    `Pair: master=${input.masterSalesforceId} duplicate=${input.duplicateSalesforceId}`,
  );
  input.logger.error(
    `Completed steps: ${input.completedSteps.join(", ") || "salesforce_merge"}`,
  );
  input.logger.error(
    "This command is safe to re-run with the same --master/--duplicate pair.",
  );
}

export async function mergeSfContactPair(input: {
  readonly db: Stage1Database;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly logger?: Logger;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => Date;
}): Promise<MergeSfContactPairResult> {
  const logger = input.logger ?? console;
  const now = input.now ?? (() => new Date());
  const executedAt = now().toISOString();
  const flags = parseCliFlags(input.args);
  const masterSalesforceId = validateSalesforceContactId(
    "master",
    readRequiredFlag(flags, "master"),
  );
  const duplicateSalesforceId = validateSalesforceContactId(
    "duplicate",
    readRequiredFlag(flags, "duplicate"),
  );
  const dryRun = !readOptionalBooleanFlag(flags, "execute", false);
  const masterLocalId = buildLocalSalesforceContactId(masterSalesforceId);
  const duplicateLocalId = buildLocalSalesforceContactId(duplicateSalesforceId);
  const completedSteps: CompletedStep[] = [];
  const salesforceConfig = readSalesforceConfig(input.env);
  const salesforceApiVersion = salesforceConfig.apiVersion ?? "61.0";

  if (masterSalesforceId === duplicateSalesforceId) {
    throw new Error("--master and --duplicate must be different Salesforce Contact IDs.");
  }

  const salesforceContacts = await loadSalesforceContacts({
    config: salesforceConfig,
    contactIds: [masterSalesforceId, duplicateSalesforceId],
    ...(input.fetchImplementation === undefined
      ? {}
      : {
          fetchImplementation: input.fetchImplementation,
        }),
    now,
  });
  const masterSalesforceRecord = requireValue(
    salesforceContacts.get(masterSalesforceId),
    `Salesforce Contact ${masterSalesforceId} was not found.`,
  );
  const duplicateSalesforceRecord = requireValue(
    salesforceContacts.get(duplicateSalesforceId),
    `Salesforce Contact ${duplicateSalesforceId} was not found.`,
  );

  if (masterSalesforceRecord.isDeleted) {
    throw new Error(
      `Salesforce master ${masterSalesforceId} is deleted and cannot receive a merge.`,
    );
  }

  let salesforceMergeStatus: SalesforceMergeStatus = "planned";

  if (duplicateSalesforceRecord.isDeleted) {
    if (duplicateSalesforceRecord.masterRecordId === masterSalesforceId) {
      if (dryRun) {
        throw new Error(
          `Salesforce duplicate ${duplicateSalesforceId} is already deleted/merged into ${masterSalesforceId}; dry-run refuses deleted duplicates.`,
        );
      }

      salesforceMergeStatus = "already_merged_to_master";
    } else {
      throw new Error(
        duplicateSalesforceRecord.masterRecordId === null
          ? `Salesforce duplicate ${duplicateSalesforceId} is already deleted and cannot be merged.`
          : `Salesforce duplicate ${duplicateSalesforceId} is already merged into ${duplicateSalesforceRecord.masterRecordId}, not ${masterSalesforceId}.`,
      );
    }
  }

  const masterLocalRecord = await loadLocalContact({
    db: input.db,
    localContactId: masterLocalId,
  });
  const duplicateLocalRecord = await loadLocalContact({
    db: input.db,
    localContactId: duplicateLocalId,
  });

  if (masterLocalRecord === null) {
    throw new Error(
      `Local contact ${masterLocalId} was not found for Salesforce Contact ${masterSalesforceId}.`,
    );
  }

  if (duplicateLocalRecord === null && dryRun) {
    throw new Error(
      `Local contact ${duplicateLocalId} was not found for Salesforce Contact ${duplicateSalesforceId}.`,
    );
  }

  if (
    duplicateLocalRecord === null &&
    salesforceMergeStatus !== "already_merged_to_master"
  ) {
    throw new Error(
      `Local contact ${duplicateLocalId} was not found for Salesforce Contact ${duplicateSalesforceId}.`,
    );
  }

  logger.log("merge-sf-contact-pair");
  logger.log(`Mode: ${dryRun ? "dry-run" : "execute"}`);
  logger.log(`Pair: master=${masterSalesforceId} duplicate=${duplicateSalesforceId}`);

  try {
    const preflightPlatformResult = await performPlatformRepoint({
      db: input.db,
      masterLocalId,
      duplicateLocalId,
      duplicateLocalRecordExists: duplicateLocalRecord !== null,
      executedAt,
      dryRun: true,
    });

    logger.log(
      JSON.stringify({
        event: "merge_sf_contact_pair.plan",
        dryRun,
        masterSalesforceId,
        duplicateSalesforceId,
        masterLocalId,
        duplicateLocalId,
        salesforce: {
          master: masterSalesforceRecord,
          duplicate: duplicateSalesforceRecord,
          mergeStatus:
            salesforceMergeStatus === "already_merged_to_master"
              ? "already_merged_to_master"
              : "will_merge",
        },
        local: {
          master: masterLocalRecord,
          duplicate: duplicateLocalRecord,
        },
        platformCounts: preflightPlatformResult.counts,
      }),
    );

    if (dryRun) {
      return {
        dryRun,
        masterSalesforceId,
        duplicateSalesforceId,
        masterLocalId,
        duplicateLocalId,
        salesforceMergeStatus,
        masterSalesforceRecord,
        duplicateSalesforceRecord,
        masterLocalRecord,
        duplicateLocalRecord,
        platformCounts: preflightPlatformResult.counts,
        identityCasesResolved: 0,
        inboxProjectionExistsAfterRefresh: false,
        inboxProjectionChanged: false,
        completedSteps: [],
        nothingToDo:
          salesforceMergeStatus === "already_merged_to_master" &&
          sumPlatformCounts(preflightPlatformResult.counts) === 0,
      };
    }

    if (salesforceMergeStatus !== "already_merged_to_master") {
      const session = await exchangeSalesforceJwtBearerAccessToken(
        {
          loginUrl: salesforceConfig.loginUrl,
          clientId: salesforceConfig.clientId,
          username: salesforceConfig.username,
          jwtPrivateKey: salesforceConfig.jwtPrivateKey,
          jwtExpirationSeconds: salesforceConfig.jwtExpirationSeconds,
          timeoutMs: salesforceConfig.timeoutMs,
        },
        {
          now,
          ...(input.fetchImplementation === undefined
            ? {}
            : {
                fetchImplementation: input.fetchImplementation,
              }),
        },
      );

      await mergeSalesforceContactPairViaSoap({
        instanceUrl: session.instanceUrl,
        apiVersion: salesforceApiVersion,
        sessionId: session.accessToken,
        masterContactId: masterSalesforceId,
        duplicateContactId: duplicateSalesforceId,
        ...(input.fetchImplementation === undefined
          ? {}
          : {
              fetchImplementation: input.fetchImplementation,
            }),
        ...(salesforceConfig.timeoutMs === undefined
          ? {}
          : {
              timeoutMs: salesforceConfig.timeoutMs,
            }),
      });
      salesforceMergeStatus = "merged";
    }

    completedSteps.push("salesforce_merge");

    const platformResult = await performPlatformRepoint({
      db: input.db,
      masterLocalId,
      duplicateLocalId,
      duplicateLocalRecordExists: duplicateLocalRecord !== null,
      executedAt,
      dryRun: false,
    });
    completedSteps.push("platform_repoint");

    const resolutionExplanation = buildIdentityResolutionExplanation({
      masterSalesforceId,
      duplicateSalesforceId,
      executedAt,
    });
    const identityCasesResolved = await resolveCollapsedIdentityCases({
      db: input.db,
      masterLocalId,
      executedAt,
      resolutionExplanation,
    });
    completedSteps.push("identity_cases_resolved");

    const inboxRefreshResult = await refreshMasterInboxState({
      db: input.db,
      masterLocalId,
    });
    completedSteps.push("inbox_flags_refreshed");

    const nothingToDo =
      salesforceMergeStatus === "already_merged_to_master" &&
      sumPlatformCounts(platformResult.counts) === 0 &&
      identityCasesResolved === 0 &&
      !inboxRefreshResult.projectionChanged;

    logger.log(
      JSON.stringify({
        event: "merge_sf_contact_pair.completed",
        dryRun: false,
        masterSalesforceId,
        duplicateSalesforceId,
        salesforceMergeStatus,
        platformCounts: platformResult.counts,
        identityCasesResolved,
        inboxProjectionExistsAfterRefresh:
          inboxRefreshResult.projectionExistsAfterRefresh,
        inboxProjectionChanged: inboxRefreshResult.projectionChanged,
        completedSteps,
        nothingToDo,
      }),
    );

    return {
      dryRun: false,
      masterSalesforceId,
      duplicateSalesforceId,
      masterLocalId,
      duplicateLocalId,
      salesforceMergeStatus,
      masterSalesforceRecord,
      duplicateSalesforceRecord,
      masterLocalRecord,
      duplicateLocalRecord,
      platformCounts: platformResult.counts,
      identityCasesResolved,
      inboxProjectionExistsAfterRefresh:
        inboxRefreshResult.projectionExistsAfterRefresh,
      inboxProjectionChanged: inboxRefreshResult.projectionChanged,
      completedSteps,
      nothingToDo,
    };
  } catch (error) {
    if (error instanceof SqlStatementError) {
      logSqlStatementError(logger, error);
    }

    if (completedSteps.includes("salesforce_merge")) {
      logRecoveryNotice({
        logger,
        masterSalesforceId,
        duplicateSalesforceId,
        completedSteps,
      });
    }

    throw error;
  }
}

export async function runMergeSfContactPairCommand(
  args: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env,
  logger: Logger = console,
  input?: {
    readonly fetchImplementation?: typeof fetch;
    readonly now?: () => Date;
  },
): Promise<MergeSfContactPairResult> {
  const connection = createDatabaseConnection({
    connectionString: readConnectionString(env),
  });

  try {
    return await mergeSfContactPair({
      db: connection.db,
      args,
      env,
      logger,
      ...(input?.fetchImplementation === undefined
        ? {}
        : {
            fetchImplementation: input.fetchImplementation,
          }),
      ...(input?.now === undefined
        ? {}
        : {
            now: input.now,
          }),
    });
  } finally {
    await closeDatabaseConnection(connection);
  }
}
