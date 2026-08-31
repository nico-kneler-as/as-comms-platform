import {
  aiKnowledgeSourcesSchema,
  aiKnowledgeEntrySchema,
  automatedEmailRenderedPreviewSchema,
  automatedEmailSendRecordSchema,
  automatedEmailTemplateRecordSchema,
  auditEvidenceSchema,
  broadcastOpenRecordSchema,
  broadcastLinkClickRecordSchema,
  broadcastUploadedRecipientInputSchema,
  broadcastUploadedRecipientRecordSchema,
  createMediaAssetInputSchema,
  canonicalEventSchema,
  canonicalEventAudienceSchema,
  composerDraftAttachmentSchema,
  composerDraftForwardContextSchema,
  composerDraftUpsertInputSchema,
  contactIdentitySchema,
  contactMembershipSchema,
  contactSchema,
  dependencyAuditSummaryRecordSchema,
  expeditionDimensionSchema,
  gmailMessageDetailSchema,
  integrationBackfillJobSchema,
  integrationHealthSchema,
  identityResolutionSchema,
  inboxProjectionSchema,
  mailchimpCampaignActivityDetailSchema,
  messageAttachmentSchema,
  manualNoteDetailSchema,
  mediaAssetRecordSchema,
  mcpOAuthAuthorizationCodeRecordSchema,
  mcpOAuthClientRecordSchema,
  mcpOAuthTokenRecordSchema,
  opsDigestWatermarkRecordSchema,
  type BroadcastLinkClickClient,
  type BroadcastLinkClickGeo,
  type BroadcastLinkClickRecord as BroadcastLinkClickContractRecord,
  type BroadcastOpenRecord as BroadcastOpenContractRecord,
  type BroadcastUploadedRecipientInput,
  type BroadcastUploadedRecipientRecord as BroadcastUploadedRecipientContractRecord,
  newsletterSubscriberRecordSchema,
  newsletterSuppressionRecordSchema,
  upsertNewsletterSubscriberInputSchema,
  upsertNewsletterSuppressionInputSchema,
  createMcpOAuthAuthorizationCodeInputSchema,
  createMcpOAuthClientInputSchema,
  createMcpOAuthTokenInputSchema,
  createOrgSenderInputSchema,
  orgSenderRecordSchema,
  projectKnowledgeEntrySchema,
  projectDimensionSchema,
  routingReviewSchema,
  salesforceReconciliationRunSchema,
  salesforceCommunicationDetailSchema,
  salesforceEventContextSchema,
  simpleTextingMessageDetailSchema,
  sourceEvidenceSchema,
  syncStateSchema,
  timelineProjectionSchema,
  type AuditEvidenceRecord,
  type AiKnowledgeEntryRecord,
  type AutomatedEmailSendRecord as AutomatedEmailSendContractRecord,
  type AutomatedEmailTemplateRecord as AutomatedEmailTemplateContractRecord,
  type CanonicalEventRecord,
  type CanonicalEventAudienceRecord,
  type ComposerDraftChannel,
  type ComposerDraftForwardContext,
  type ComposerDraftPaneMode as ComposerDraftPaneModeDb,
  type ComposerDraftRecipientKind,
  type ContactIdentityRecord,
  type ContactMembershipRecord,
  type ContactRecord,
  type DependencyAuditSummaryRecord,
  type ExpeditionDimensionRecord,
  type GmailMessageDetailRecord,
  type IntegrationBackfillJobRecord,
  type IntegrationHealthRecord,
  type IdentityResolutionCase,
  type InboxProjectionRow,
  type MailchimpCampaignActivityDetailRecord,
  type MessageAttachmentRecord,
  type ManualNoteDetailRecord,
  type MediaAssetRecord as MediaAssetContractRecord,
  type McpOAuthAuthorizationCodeRecord,
  type McpOAuthClientRecord,
  type McpOAuthTokenRecord,
  type NewsletterSubscriberRecord,
  type NewsletterSuppressionRecord,
  type OpsDigestWatermarkRecord,
  type OrgSenderRecord,
  type ProjectKnowledgeEntryRecord,
  type ProjectDimensionRecord,
  type RoutingReviewCase,
  type SalesforceReconciliationRunRecord,
  type SalesforceCommunicationDetailRecord,
  type SalesforceEventContextRecord,
  type SimpleTextingMessageDetailRecord,
  type SourceEvidenceRecord,
  type SyncStateRecord,
  type TimelineProjectionRow,
} from "@as-comms/contracts";

import type {
  PendingComposerOutboundRecord,
  ProjectAliasRecord,
  SourceEvidenceQuarantineInput,
  SourceEvidenceQuarantineRecord,
  ConsentRecord,
  SmsMessageRecord,
  SmsSenderRecord,
  UserRecord,
} from "@as-comms/domain";
import { z } from "zod";

import type {
  aiKnowledgeEntries,
  auditPolicyEvidence,
  automatedEmailSends,
  automatedEmailTemplates,
  broadcastLinkClicks,
  broadcastOpens,
  broadcastUploadedRecipients,
  canonicalEventLedger,
  canonicalEventAudience,
  broadcastMediaAssets,
  composerDrafts,
  consentRecords,
  contactIdentities,
  contactInboxProjection,
  contactMemberships,
  contactTimelineProjection,
  contacts,
  dependencyAuditSummary,
  expeditionDimensions,
  gmailMessageDetails,
  integrationBackfillJobs,
  integrationHealth,
  identityResolutionQueue,
  mailchimpCampaignActivityDetails,
  messageAttachments,
  manualNoteDetails,
  mcpOAuthAuthorizationCodes,
  mcpOAuthClients,
  mcpOAuthTokens,
  newsletterSubscribers,
  newsletterSuppressions,
  orgSenders,
  opsDigestWatermark,
  pendingComposerOutbounds,
  projectAliases,
  projectKnowledgeEntries,
  projectDimensions,
  routingReviewQueue,
  salesforceCommunicationDetails,
  salesforceReconciliationRuns,
  salesforceEventContext,
  simpleTextingMessageDetails,
  smsMessages,
  smsSenders,
  sourceEvidenceLog,
  sourceEvidenceQuarantine,
  syncState,
  users,
} from "./schema/index.js";

type SourceEvidenceRow = typeof sourceEvidenceLog.$inferSelect;
type SourceEvidenceQuarantineRow = typeof sourceEvidenceQuarantine.$inferSelect;
type AiKnowledgeEntryRow = typeof aiKnowledgeEntries.$inferSelect;
type ProjectKnowledgeEntryRow = typeof projectKnowledgeEntries.$inferSelect;
type CanonicalEventRow = typeof canonicalEventLedger.$inferSelect;
type CanonicalEventAudienceRow = typeof canonicalEventAudience.$inferSelect;
type ContactRow = typeof contacts.$inferSelect;
type ContactIdentityRow = typeof contactIdentities.$inferSelect;
type ContactMembershipRow = typeof contactMemberships.$inferSelect;
type SmsMessageRow = typeof smsMessages.$inferSelect;
type ConsentRecordRow = typeof consentRecords.$inferSelect;
type SmsSenderRow = typeof smsSenders.$inferSelect;
type ProjectDimensionRow = typeof projectDimensions.$inferSelect;
type ExpeditionDimensionRow = typeof expeditionDimensions.$inferSelect;
type GmailMessageDetailRow = typeof gmailMessageDetails.$inferSelect;
type IntegrationBackfillJobRow = typeof integrationBackfillJobs.$inferSelect;
type IntegrationHealthRow = typeof integrationHealth.$inferSelect;
type SalesforceEventContextRow = typeof salesforceEventContext.$inferSelect;
type SalesforceCommunicationDetailRow =
  typeof salesforceCommunicationDetails.$inferSelect;
type SimpleTextingMessageDetailRow =
  typeof simpleTextingMessageDetails.$inferSelect;
type MailchimpCampaignActivityDetailRow =
  typeof mailchimpCampaignActivityDetails.$inferSelect;
type MessageAttachmentRow = typeof messageAttachments.$inferSelect;
type ManualNoteDetailRow = typeof manualNoteDetails.$inferSelect;
type OpsDigestWatermarkRow = typeof opsDigestWatermark.$inferSelect;
type DependencyAuditSummaryRow = typeof dependencyAuditSummary.$inferSelect;
type PendingComposerOutboundRow = typeof pendingComposerOutbounds.$inferSelect;
type IdentityResolutionRow = typeof identityResolutionQueue.$inferSelect;
type RoutingReviewRow = typeof routingReviewQueue.$inferSelect;
type InboxProjectionRowDb = typeof contactInboxProjection.$inferSelect;
type TimelineProjectionRowDb = typeof contactTimelineProjection.$inferSelect;
type SyncStateRow = typeof syncState.$inferSelect;
type AuditEvidenceRow = typeof auditPolicyEvidence.$inferSelect;
type UserRow = typeof users.$inferSelect;
type ProjectAliasRow = typeof projectAliases.$inferSelect;
type SalesforceReconciliationRunRow =
  typeof salesforceReconciliationRuns.$inferSelect;
type ComposerDraftDbRow = typeof composerDrafts.$inferSelect;
type ComposerDraftDbRowInsert = typeof composerDrafts.$inferInsert;
type BroadcastLinkClickDbRowInsert = typeof broadcastLinkClicks.$inferInsert;
type BroadcastOpenDbRowInsert = typeof broadcastOpens.$inferInsert;
type BroadcastUploadedRecipientDbRowInsert =
  typeof broadcastUploadedRecipients.$inferInsert;
type BroadcastMediaAssetRowInsert = typeof broadcastMediaAssets.$inferInsert;
type AutomatedEmailTemplateTableRowInsert =
  typeof automatedEmailTemplates.$inferInsert;
type AutomatedEmailSendTableRowInsert = typeof automatedEmailSends.$inferInsert;
type McpOAuthClientTableRowInsert = typeof mcpOAuthClients.$inferInsert;
type McpOAuthAuthorizationCodeTableRowInsert =
  typeof mcpOAuthAuthorizationCodes.$inferInsert;
type McpOAuthTokenTableRowInsert = typeof mcpOAuthTokens.$inferInsert;
type NewsletterSubscriberTableRowInsert =
  typeof newsletterSubscribers.$inferInsert;
type NewsletterSuppressionTableRowInsert =
  typeof newsletterSuppressions.$inferInsert;
type OrgSenderTableRowInsert = typeof orgSenders.$inferInsert;

type ContactRowInput = Omit<
  ContactRow,
  "salesforceDeletedAt" | "salesforceReconciledAt"
> &
  Partial<Pick<ContactRow, "salesforceDeletedAt" | "salesforceReconciledAt">>;

type ContactMembershipRowInput = Omit<
  ContactMembershipRow,
  "salesforceDeletedAt" | "salesforceReconciledAt"
> &
  Partial<
    Pick<ContactMembershipRow, "salesforceDeletedAt" | "salesforceReconciledAt">
  >;

type ProjectDimensionRowInput = Omit<
  ProjectDimensionRow,
  "salesforceDeletedAt" | "salesforceReconciledAt"
> &
  Partial<
    Pick<ProjectDimensionRow, "salesforceDeletedAt" | "salesforceReconciledAt">
  >;

function fromDate(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function toDate(value: string): Date {
  return new Date(value);
}

function mapComposerDraftPaneModeFromDb(
  value: ComposerDraftDbRow["paneMode"],
): ComposerDraftPaneMode {
  if (value === "new_draft") {
    return "new-draft";
  }

  return value;
}

function mapComposerDraftPaneModeToDb(
  value: ComposerDraftPaneMode,
): ComposerDraftPaneModeDb {
  if (value === "new-draft") {
    return "new_draft";
  }

  return value;
}

function parseEmailAddressArray(
  value: unknown,
): readonly string[] {
  const parsed = z.array(z.string().trim().email()).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function parseComposerDraftAttachments(
  value: unknown,
): readonly {
  readonly filename: string;
  readonly size: number;
  readonly contentType: string;
}[] {
  const parsed = z.array(composerDraftAttachmentSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function parseComposerDraftForwardContext(
  value: unknown,
): ComposerDraftForwardContext | null {
  const parsed = composerDraftForwardContextSchema.nullable().safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type ComposerDraftRow = Readonly<{
  id: string;
  actor_id: string;
  pane_mode: ComposerDraftDbRow["paneMode"];
  channel: ComposerDraftChannel;
  recipient_anchor_kind: ComposerDraftRecipientKind | null;
  recipient_contact_id: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  subject: string;
  body_plaintext: string;
  body_html: string;
  selected_alias: string | null;
  cc: unknown;
  bcc: unknown;
  attachments: unknown;
  ai_directive: string;
  reply_context_thread_cursor: string | null;
  forward_context: unknown;
  created_at: Date;
  updated_at: Date;
}>;

export type ComposerDraftRowInsert = ComposerDraftDbRowInsert;

export type ComposerDraftPaneMode = "new-draft" | "replying" | "forwarding";

export type ComposerDraftInsert = Omit<
  z.input<typeof composerDraftUpsertInputSchema>,
  "pane_mode"
> & {
  pane_mode: ComposerDraftPaneMode;
};

export type MediaAssetRow = Readonly<{
  id: string;
  uploader_id: string | null;
  storage_key: string;
  public_url: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: Date;
  deleted_at: Date | null;
}>;

export type MediaAssetRowInsert = BroadcastMediaAssetRowInsert;

export type MediaAssetInsert = z.input<typeof createMediaAssetInputSchema>;

export type MediaAssetRecord = MediaAssetContractRecord;

export type AutomatedEmailTemplateRow = Readonly<{
  id: string;
  project_id: string;
  kind: AutomatedEmailTemplateContractRecord["kind"];
  name: string;
  draft_subject: string;
  draft_doc: unknown;
  published_subject: string | null;
  published_doc: unknown;
  published_at: Date | null;
  published_by: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}>;

export type AutomatedEmailSendRow = Readonly<{
  id: string;
  template_id: string;
  project_id: string;
  expedition_member_id: string;
  contact_id: string | null;
  status: AutomatedEmailSendContractRecord["status"];
  status_reason: string | null;
  payload: unknown;
  rendered_preview: unknown;
  ledger_event_id: string | null;
  provider_message_id: string | null;
  received_at: Date;
  processed_at: Date | null;
}>;

export type AutomatedEmailTemplateInsert = Readonly<{
  projectId: string;
  kind?: AutomatedEmailTemplateContractRecord["kind"];
  name: string;
  draftSubject?: string;
  draftDoc?: unknown;
  createdBy: string | null;
}>;

export type AutomatedEmailSendInsert = Readonly<{
  templateId: string;
  projectId: string;
  expeditionMemberId: string;
  contactId: string | null;
  payload: unknown;
}>;

export type AutomatedEmailTemplateRowInsert =
  AutomatedEmailTemplateTableRowInsert;
export type AutomatedEmailSendRowInsert = AutomatedEmailSendTableRowInsert;

export type McpOAuthClientRow = Readonly<{
  id: string;
  client_id: string;
  client_secret_hash: string;
  name: string;
  allowed_redirect_uris: readonly string[];
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}>;

export type McpOAuthClientInsert = z.input<typeof createMcpOAuthClientInputSchema>;

export type McpOAuthClientRowInsert = McpOAuthClientTableRowInsert;

export type McpOAuthAuthorizationCodeRow = Readonly<{
  id: string;
  authorization_code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}>;

export type McpOAuthAuthorizationCodeInsert = z.input<
  typeof createMcpOAuthAuthorizationCodeInputSchema
>;

export type McpOAuthAuthorizationCodeRowInsert =
  McpOAuthAuthorizationCodeTableRowInsert;

export type McpOAuthTokenRow = Readonly<{
  id: string;
  access_token_hash: string;
  refresh_token_hash: string;
  client_id: string;
  user_id: string;
  scope: string;
  resource: string;
  token_family_id: string;
  authorization_code_hash: string | null;
  rotated_from_token_id: string | null;
  access_expires_at: Date;
  refresh_expires_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}>;

export type McpOAuthTokenInsert = z.input<typeof createMcpOAuthTokenInputSchema>;

export type McpOAuthTokenRowInsert = McpOAuthTokenTableRowInsert;

export type BroadcastLinkClickRow = Readonly<{
  id: string;
  campaign_run_id: string;
  audience_snapshot_id: string | null;
  contact_id: string | null;
  original_link: string;
  clicked_at: Date;
  user_agent: string | null;
  platform: string | null;
  client: BroadcastLinkClickClient | null;
  os: BroadcastLinkClickClient | null;
  geo: BroadcastLinkClickGeo | null;
  is_bot: boolean;
  bot_reason: BroadcastLinkClickContractRecord["botReason"];
  idempotency_key: string;
  created_at: Date;
}>;

export type BroadcastLinkClickRowInsert = BroadcastLinkClickDbRowInsert;

export type BroadcastLinkClickInsert = z.input<
  typeof broadcastLinkClickRecordSchema
>;

export type BroadcastLinkClickRecord = BroadcastLinkClickContractRecord;

export type BroadcastOpenRow = Readonly<{
  id: string;
  campaign_run_id: string;
  audience_snapshot_id: string | null;
  contact_id: string | null;
  opened_at: Date;
  user_agent: string | null;
  platform: string | null;
  client: BroadcastLinkClickClient | null;
  os: BroadcastLinkClickClient | null;
  geo: BroadcastLinkClickGeo | null;
  is_bot: boolean;
  bot_reason: BroadcastOpenContractRecord["botReason"];
  idempotency_key: string;
  created_at: Date;
}>;

export type BroadcastOpenRowInsert = BroadcastOpenDbRowInsert;

export type BroadcastOpenInsert = z.input<typeof broadcastOpenRecordSchema>;

export type BroadcastOpenRecord = BroadcastOpenContractRecord;

export type BroadcastUploadedRecipientRow = Readonly<{
  id: string;
  campaign_run_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: Date;
}>;

export type BroadcastUploadedRecipientRowInsert =
  Omit<
    BroadcastUploadedRecipientDbRowInsert,
    "id" | "campaignRunId" | "createdAt"
  >;

export type BroadcastUploadedRecipientInsert = BroadcastUploadedRecipientInput;

export type BroadcastUploadedRecipientRecord =
  BroadcastUploadedRecipientContractRecord;

export type NewsletterSubscriberRow = Readonly<{
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  member_rating: number | null;
  optin_time: Date | null;
  optin_ip: string | null;
  confirm_time: Date | null;
  confirm_ip: string | null;
  last_changed_at: Date | null;
  interests: string | null;
  tags: string | null;
  source: string;
  created_at: Date;
  updated_at: Date;
}>;

export type NewsletterSubscriberInsert = z.input<
  typeof upsertNewsletterSubscriberInputSchema
>;

export type NewsletterSubscriberRowInsert = NewsletterSubscriberTableRowInsert;

export type NewsletterSuppressionRow = Readonly<{
  id: string;
  email: string;
  reason: string;
  source: string;
  created_at: Date;
  updated_at: Date;
}>;

export type NewsletterSuppressionInsert = z.input<
  typeof upsertNewsletterSuppressionInputSchema
>;

export type NewsletterSuppressionRowInsert =
  NewsletterSuppressionTableRowInsert;

export type OrgSenderRow = Readonly<{
  id: string;
  email: string;
  label: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}>;

export type OrgSenderInsert = z.input<typeof createOrgSenderInputSchema>;

export type OrgSenderRowInsert = OrgSenderTableRowInsert;

export type ComposerDraftRecord = Readonly<{
  id: string;
  actorId: string;
  paneMode: ComposerDraftPaneMode;
  channel: ComposerDraftChannel;
  recipientAnchorKind: ComposerDraftRecipientKind | null;
  recipientContactId: string | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
  subject: string;
  bodyPlaintext: string;
  bodyHtml: string;
  selectedAlias: string | null;
  cc: readonly string[];
  bcc: readonly string[];
  attachments: readonly z.infer<typeof composerDraftAttachmentSchema>[];
  aiDirective: string;
  replyContextThreadCursor: string | null;
  forwardContext: ComposerDraftForwardContext | null;
  createdAt: string;
  updatedAt: string;
}>;

export function mapComposerDraftRow(row: ComposerDraftRow): ComposerDraftRecord {
  return {
    id: row.id,
    actorId: row.actor_id,
    paneMode: mapComposerDraftPaneModeFromDb(row.pane_mode),
    channel: row.channel,
    recipientAnchorKind: row.recipient_anchor_kind,
    recipientContactId: row.recipient_contact_id,
    recipientEmail: row.recipient_email,
    recipientPhone: row.recipient_phone,
    subject: row.subject,
    bodyPlaintext: row.body_plaintext,
    bodyHtml: row.body_html,
    selectedAlias: row.selected_alias,
    cc: parseEmailAddressArray(row.cc),
    bcc: parseEmailAddressArray(row.bcc),
    attachments: parseComposerDraftAttachments(row.attachments),
    aiDirective: row.ai_directive,
    replyContextThreadCursor: row.reply_context_thread_cursor,
    forwardContext: parseComposerDraftForwardContext(row.forward_context),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function mapComposerDraftInsert(
  record: ComposerDraftInsert,
): ComposerDraftRowInsert {
  const parsed = composerDraftUpsertInputSchema.parse({
    ...record,
    pane_mode: mapComposerDraftPaneModeToDb(record.pane_mode),
  });

  return {
    actorId: parsed.actor_id,
    paneMode: parsed.pane_mode,
    channel: parsed.channel,
    recipientAnchorKind: parsed.recipient_anchor_kind,
    recipientContactId: parsed.recipient_contact_id,
    recipientEmail: parsed.recipient_email,
    recipientPhone: parsed.recipient_phone,
    subject: parsed.subject,
    bodyPlaintext: parsed.body_plaintext,
    bodyHtml: parsed.body_html,
    selectedAlias: parsed.selected_alias,
    cc: parsed.cc,
    bcc: parsed.bcc,
    attachments: parsed.attachments,
    aiDirective: parsed.ai_directive,
    replyContextThreadCursor: parsed.reply_context_thread_cursor,
    forwardContext: parsed.forward_context ?? undefined,
  };
}

export function mapMediaAssetRow(row: MediaAssetRow): MediaAssetRecord {
  return mediaAssetRecordSchema.parse({
    id: row.id,
    uploaderId: row.uploader_id,
    storageKey: row.storage_key,
    publicUrl: row.public_url,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
  });
}

export function mapMediaAssetInsert(record: MediaAssetInsert): MediaAssetRowInsert {
  const parsed = createMediaAssetInputSchema.parse(record);

  return {
    uploaderId: parsed.uploaderId,
    storageKey: parsed.storageKey,
    publicUrl: parsed.publicUrl,
    filename: parsed.filename,
    contentType: parsed.contentType,
    sizeBytes: parsed.sizeBytes,
  };
}

export function mapAutomatedEmailTemplateRow(
  row: AutomatedEmailTemplateRow,
): AutomatedEmailTemplateContractRecord {
  return automatedEmailTemplateRecordSchema.parse({
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    name: row.name,
    draftSubject: row.draft_subject,
    draftDoc: row.draft_doc,
    publishedSubject: row.published_subject,
    publishedDoc: row.published_doc,
    publishedAt: fromDate(row.published_at),
    publishedBy: row.published_by,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

export function mapAutomatedEmailTemplateInsert(
  record: AutomatedEmailTemplateInsert,
): AutomatedEmailTemplateRowInsert {
  return {
    projectId: record.projectId,
    kind: record.kind ?? "custom",
    name: record.name,
    draftSubject: record.draftSubject ?? "",
    draftDoc: record.draftDoc ?? {},
    createdBy: record.createdBy,
  };
}

export function mapAutomatedEmailSendRow(
  row: AutomatedEmailSendRow,
): AutomatedEmailSendContractRecord {
  return automatedEmailSendRecordSchema.parse({
    id: row.id,
    templateId: row.template_id,
    projectId: row.project_id,
    expeditionMemberId: row.expedition_member_id,
    contactId: row.contact_id,
    status: row.status,
    statusReason: row.status_reason,
    payload: row.payload,
    renderedPreview:
      row.rendered_preview === null
        ? null
        : automatedEmailRenderedPreviewSchema.parse(row.rendered_preview),
    ledgerEventId: row.ledger_event_id,
    providerMessageId: row.provider_message_id,
    receivedAt: row.received_at.toISOString(),
    processedAt: fromDate(row.processed_at),
  });
}

export function mapAutomatedEmailSendInsert(
  record: AutomatedEmailSendInsert,
): AutomatedEmailSendRowInsert {
  return {
    templateId: record.templateId,
    projectId: record.projectId,
    expeditionMemberId: record.expeditionMemberId,
    contactId: record.contactId,
    status: "received",
    payload: record.payload,
  };
}

export function mapMcpOAuthClientRow(
  row: McpOAuthClientRow,
): McpOAuthClientRecord {
  return mcpOAuthClientRecordSchema.parse({
    id: row.id,
    clientId: row.client_id,
    clientSecretHash: row.client_secret_hash,
    name: row.name,
    allowedRedirectUris: row.allowed_redirect_uris,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

export function mapMcpOAuthClientInsert(
  record: McpOAuthClientInsert,
): McpOAuthClientRowInsert {
  const parsed = createMcpOAuthClientInputSchema.parse(record);

  return {
    clientId: parsed.clientId,
    clientSecretHash: parsed.clientSecretHash,
    name: parsed.name,
    allowedRedirectUris: parsed.allowedRedirectUris,
  };
}

export function mapMcpOAuthAuthorizationCodeRow(
  row: McpOAuthAuthorizationCodeRow,
): McpOAuthAuthorizationCodeRecord {
  return mcpOAuthAuthorizationCodeRecordSchema.parse({
    id: row.id,
    authorizationCodeHash: row.authorization_code_hash,
    clientId: row.client_id,
    userId: row.user_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    scope: row.scope,
    resource: row.resource,
    expiresAt: row.expires_at.toISOString(),
    consumedAt: row.consumed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

export function mapMcpOAuthAuthorizationCodeInsert(
  record: McpOAuthAuthorizationCodeInsert,
): McpOAuthAuthorizationCodeRowInsert {
  const parsed = createMcpOAuthAuthorizationCodeInputSchema.parse(record);

  return {
    authorizationCodeHash: parsed.authorizationCodeHash,
    clientId: parsed.clientId,
    userId: parsed.userId,
    redirectUri: parsed.redirectUri,
    codeChallenge: parsed.codeChallenge,
    scope: parsed.scope,
    resource: parsed.resource,
    expiresAt: toDate(parsed.expiresAt),
  };
}

export function mapMcpOAuthTokenRow(
  row: McpOAuthTokenRow,
): McpOAuthTokenRecord {
  return mcpOAuthTokenRecordSchema.parse({
    id: row.id,
    accessTokenHash: row.access_token_hash,
    refreshTokenHash: row.refresh_token_hash,
    clientId: row.client_id,
    userId: row.user_id,
    scope: row.scope,
    resource: row.resource,
    tokenFamilyId: row.token_family_id,
    authorizationCodeHash: row.authorization_code_hash,
    rotatedFromTokenId: row.rotated_from_token_id,
    accessExpiresAt: row.access_expires_at.toISOString(),
    refreshExpiresAt: row.refresh_expires_at.toISOString(),
    rotatedAt: row.rotated_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

export function mapMcpOAuthTokenInsert(
  record: McpOAuthTokenInsert,
): McpOAuthTokenRowInsert {
  const parsed = createMcpOAuthTokenInputSchema.parse(record);

  return {
    accessTokenHash: parsed.accessTokenHash,
    refreshTokenHash: parsed.refreshTokenHash,
    clientId: parsed.clientId,
    userId: parsed.userId,
    scope: parsed.scope,
    resource: parsed.resource,
    tokenFamilyId: parsed.tokenFamilyId,
    authorizationCodeHash: parsed.authorizationCodeHash ?? null,
    rotatedFromTokenId: parsed.rotatedFromTokenId ?? null,
    accessExpiresAt: toDate(parsed.accessExpiresAt),
    refreshExpiresAt: toDate(parsed.refreshExpiresAt),
  };
}

export function mapBroadcastLinkClickRow(
  row: BroadcastLinkClickRow,
): BroadcastLinkClickRecord {
  return broadcastLinkClickRecordSchema.parse({
    id: row.id,
    campaignRunId: row.campaign_run_id,
    audienceSnapshotId: row.audience_snapshot_id,
    contactId: row.contact_id,
    originalLink: row.original_link,
    clickedAt: row.clicked_at.toISOString(),
    userAgent: row.user_agent,
    platform: row.platform,
    client: row.client,
    os: row.os,
    geo: row.geo,
    isBot: row.is_bot,
    botReason: row.bot_reason,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at.toISOString(),
  });
}

export function mapBroadcastLinkClickInsert(
  record: BroadcastLinkClickInsert,
): BroadcastLinkClickRowInsert {
  const parsed = broadcastLinkClickRecordSchema.parse(record);

  return {
    id: parsed.id,
    campaignRunId: parsed.campaignRunId,
    audienceSnapshotId: parsed.audienceSnapshotId,
    contactId: parsed.contactId,
    originalLink: parsed.originalLink,
    clickedAt: toDate(parsed.clickedAt),
    userAgent: parsed.userAgent,
    platform: parsed.platform,
    client: parsed.client,
    os: parsed.os,
    geo: parsed.geo,
    isBot: parsed.isBot,
    botReason: parsed.botReason,
    idempotencyKey: parsed.idempotencyKey,
    createdAt: toDate(parsed.createdAt),
  };
}

export function mapBroadcastOpenRow(row: BroadcastOpenRow): BroadcastOpenRecord {
  return broadcastOpenRecordSchema.parse({
    id: row.id,
    campaignRunId: row.campaign_run_id,
    audienceSnapshotId: row.audience_snapshot_id,
    contactId: row.contact_id,
    openedAt: row.opened_at.toISOString(),
    userAgent: row.user_agent,
    platform: row.platform,
    client: row.client,
    os: row.os,
    geo: row.geo,
    isBot: row.is_bot,
    botReason: row.bot_reason,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at.toISOString(),
  });
}

export function mapBroadcastOpenInsert(
  record: BroadcastOpenInsert,
): BroadcastOpenRowInsert {
  const parsed = broadcastOpenRecordSchema.parse(record);

  return {
    id: parsed.id,
    campaignRunId: parsed.campaignRunId,
    audienceSnapshotId: parsed.audienceSnapshotId,
    contactId: parsed.contactId,
    openedAt: toDate(parsed.openedAt),
    userAgent: parsed.userAgent,
    platform: parsed.platform,
    client: parsed.client,
    os: parsed.os,
    geo: parsed.geo,
    isBot: parsed.isBot,
    botReason: parsed.botReason,
    idempotencyKey: parsed.idempotencyKey,
    createdAt: toDate(parsed.createdAt),
  };
}

export function mapBroadcastUploadedRecipientRow(
  row: BroadcastUploadedRecipientRow,
): BroadcastUploadedRecipientRecord {
  return broadcastUploadedRecipientRecordSchema.parse({
    id: row.id,
    campaignRunId: row.campaign_run_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    createdAt: row.created_at.toISOString(),
  });
}

export function mapBroadcastUploadedRecipientInsert(
  record: BroadcastUploadedRecipientInsert,
): BroadcastUploadedRecipientRowInsert {
  const parsed = broadcastUploadedRecipientInputSchema.parse(record);

  return {
    email: parsed.email,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
  };
}

export function mapNewsletterSubscriberRow(
  row: NewsletterSubscriberRow,
): NewsletterSubscriberRecord {
  return newsletterSubscriberRecordSchema.parse({
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    status: row.status,
    memberRating: row.member_rating,
    optinTime: fromDate(row.optin_time),
    optinIp: row.optin_ip,
    confirmTime: fromDate(row.confirm_time),
    confirmIp: row.confirm_ip,
    lastChangedAt: fromDate(row.last_changed_at),
    interests: row.interests,
    tags: row.tags,
    source: row.source,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

export function mapNewsletterSubscriberInsert(
  record: NewsletterSubscriberInsert,
): NewsletterSubscriberRowInsert {
  const parsed = upsertNewsletterSubscriberInputSchema.parse(record);

  return {
    email: parsed.email,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    status: parsed.status,
    memberRating: parsed.memberRating,
    optinTime:
      parsed.optinTime === undefined
        ? undefined
        : parsed.optinTime === null
          ? null
          : toDate(parsed.optinTime),
    optinIp: parsed.optinIp,
    confirmTime:
      parsed.confirmTime === undefined
        ? undefined
        : parsed.confirmTime === null
          ? null
          : toDate(parsed.confirmTime),
    confirmIp: parsed.confirmIp,
    lastChangedAt:
      parsed.lastChangedAt === undefined
        ? undefined
        : parsed.lastChangedAt === null
          ? null
          : toDate(parsed.lastChangedAt),
    interests: parsed.interests,
    tags: parsed.tags,
    source: parsed.source,
  };
}

export function mapNewsletterSuppressionRow(
  row: NewsletterSuppressionRow,
): NewsletterSuppressionRecord {
  return newsletterSuppressionRecordSchema.parse({
    id: row.id,
    email: row.email,
    reason: row.reason,
    source: row.source,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

export function mapNewsletterSuppressionInsert(
  record: NewsletterSuppressionInsert,
): NewsletterSuppressionRowInsert {
  const parsed = upsertNewsletterSuppressionInputSchema.parse(record);

  return {
    email: parsed.email,
    reason: parsed.reason,
    source: parsed.source,
  };
}

export function mapOrgSenderRow(row: OrgSenderRow): OrgSenderRecord {
  return orgSenderRecordSchema.parse({
    id: row.id,
    email: row.email,
    label: row.label,
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

export function mapOrgSenderInsert(record: OrgSenderInsert): OrgSenderRowInsert {
  const parsed = createOrgSenderInputSchema.parse(record);

  return {
    email: parsed.email,
    label: parsed.label,
  };
}

export function mapSourceEvidenceRow(
  row: SourceEvidenceRow,
): SourceEvidenceRecord {
  return sourceEvidenceSchema.parse({
    id: row.id,
    provider: row.provider,
    providerRecordType: row.providerRecordType,
    providerRecordId: row.providerRecordId,
    receivedAt: row.receivedAt.toISOString(),
    occurredAt: row.occurredAt.toISOString(),
    payloadRef: row.payloadRef,
    idempotencyKey: row.idempotencyKey,
    checksum: row.checksum,
  });
}

export function mapAiKnowledgeEntryRow(
  row: AiKnowledgeEntryRow,
): AiKnowledgeEntryRecord {
  return aiKnowledgeEntrySchema.parse({
    id: row.id,
    scope: row.scope,
    scopeKey: row.scopeKey,
    sourceProvider: row.sourceProvider,
    sourceId: row.sourceId,
    sourceUrl: row.sourceUrl,
    title: row.title,
    content: row.content,
    contentHash: row.contentHash,
    metadataJson: row.metadataJson,
    sourceLastEditedAt: fromDate(row.sourceLastEditedAt),
    syncedAt: row.syncedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapAiKnowledgeEntryToInsert(
  record: AiKnowledgeEntryRecord,
): typeof aiKnowledgeEntries.$inferInsert {
  const parsed = aiKnowledgeEntrySchema.parse(record);

  return {
    id: parsed.id,
    scope: parsed.scope,
    scopeKey: parsed.scopeKey,
    sourceProvider: parsed.sourceProvider,
    sourceId: parsed.sourceId,
    sourceUrl: parsed.sourceUrl,
    title: parsed.title,
    content: parsed.content,
    contentHash: parsed.contentHash,
    metadataJson: parsed.metadataJson,
    sourceLastEditedAt:
      parsed.sourceLastEditedAt === null ? null : toDate(parsed.sourceLastEditedAt),
    syncedAt: toDate(parsed.syncedAt),
    createdAt: toDate(parsed.createdAt),
    updatedAt: toDate(parsed.updatedAt),
  };
}

export function mapProjectKnowledgeEntryRow(
  row: ProjectKnowledgeEntryRow,
): ProjectKnowledgeEntryRecord {
  return projectKnowledgeEntrySchema.parse({
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    issueType: row.issueType,
    volunteerStage: row.volunteerStage,
    questionSummary: row.questionSummary,
    replyStrategy: row.replyStrategy,
    maskedExample: row.maskedExample,
    sourceKind: row.sourceKind,
    approvedForAi: row.approvedForAi,
    sourceEventId: row.sourceEventId,
    metadataJson: row.metadataJson,
    lastReviewedAt: fromDate(row.lastReviewedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapProjectKnowledgeEntryToInsert(
  record: ProjectKnowledgeEntryRecord,
): typeof projectKnowledgeEntries.$inferInsert {
  const parsed = projectKnowledgeEntrySchema.parse(record);

  return {
    id: parsed.id,
    projectId: parsed.projectId,
    kind: parsed.kind,
    issueType: parsed.issueType,
    volunteerStage: parsed.volunteerStage,
    questionSummary: parsed.questionSummary,
    replyStrategy: parsed.replyStrategy,
    maskedExample: parsed.maskedExample,
    sourceKind: parsed.sourceKind,
    approvedForAi: parsed.approvedForAi,
    sourceEventId: parsed.sourceEventId,
    metadataJson: parsed.metadataJson,
    lastReviewedAt:
      parsed.lastReviewedAt === null ? null : toDate(parsed.lastReviewedAt),
    createdAt: toDate(parsed.createdAt),
    updatedAt: toDate(parsed.updatedAt),
  };
}

export function mapSourceEvidenceToInsert(
  record: SourceEvidenceRecord,
): typeof sourceEvidenceLog.$inferInsert {
  const parsed = sourceEvidenceSchema.parse(record);

  return {
    id: parsed.id,
    provider: parsed.provider,
    providerRecordType: parsed.providerRecordType,
    providerRecordId: parsed.providerRecordId,
    receivedAt: toDate(parsed.receivedAt),
    occurredAt: toDate(parsed.occurredAt),
    payloadRef: parsed.payloadRef,
    idempotencyKey: parsed.idempotencyKey,
    checksum: parsed.checksum,
  };
}

export function mapSourceEvidenceQuarantineRow(
  row: SourceEvidenceQuarantineRow,
): SourceEvidenceQuarantineRecord {
  return {
    id: row.id,
    provider: row.provider,
    idempotencyKey: row.idempotencyKey,
    checksum: row.checksum,
    attemptedAt: row.attemptedAt,
    reason: row.reason as SourceEvidenceQuarantineRecord["reason"],
    payloadRef: row.payloadRef,
    details: row.detailsJsonb as Readonly<Record<string, unknown>>,
    createdAt: row.createdAt,
  };
}

export function mapSourceEvidenceQuarantineToInsert(input: {
  readonly id: string;
  readonly record: SourceEvidenceQuarantineInput;
}): typeof sourceEvidenceQuarantine.$inferInsert {
  return {
    id: input.id,
    provider: input.record.provider,
    idempotencyKey: input.record.idempotencyKey,
    checksum: input.record.checksum,
    attemptedAt: input.record.attemptedAt,
    reason: input.record.reason,
    payloadRef: input.record.payloadRef,
    detailsJsonb: input.record.details,
  };
}

export function mapCanonicalEventRow(
  row: CanonicalEventRow,
): CanonicalEventRecord {
  return canonicalEventSchema.parse({
    id: row.id,
    contactId: row.contactId,
    eventType: row.eventType,
    channel: row.channel,
    occurredAt: row.occurredAt.toISOString(),
    contentFingerprint: row.contentFingerprint,
    sourceEvidenceId: row.sourceEvidenceId,
    idempotencyKey: row.idempotencyKey,
    provenance: row.provenance,
    reviewState: row.reviewState,
  });
}

export function mapCanonicalEventToInsert(
  record: CanonicalEventRecord,
): typeof canonicalEventLedger.$inferInsert {
  const parsed = canonicalEventSchema.parse(record);

  return {
    id: parsed.id,
    contactId: parsed.contactId,
    eventType: parsed.eventType,
    channel: parsed.channel,
    occurredAt: toDate(parsed.occurredAt),
    contentFingerprint: parsed.contentFingerprint,
    sourceEvidenceId: parsed.sourceEvidenceId,
    idempotencyKey: parsed.idempotencyKey,
    provenance: parsed.provenance,
    reviewState: parsed.reviewState,
  };
}

export function mapCanonicalEventAudienceRow(
  row: CanonicalEventAudienceRow,
): CanonicalEventAudienceRecord {
  return canonicalEventAudienceSchema.parse({
    canonicalEventId: row.canonicalEventId,
    contactId: row.contactId,
    participantRole: row.participantRole,
    normalizedEmail: row.normalizedEmail,
  });
}

export function mapCanonicalEventAudienceToInsert(
  record: CanonicalEventAudienceRecord,
): typeof canonicalEventAudience.$inferInsert {
  const parsed = canonicalEventAudienceSchema.parse(record);

  return {
    canonicalEventId: parsed.canonicalEventId,
    contactId: parsed.contactId,
    participantRole: parsed.participantRole,
    normalizedEmail: parsed.normalizedEmail,
  };
}

export function mapContactRow(row: ContactRowInput): ContactRecord {
  return contactSchema.parse({
    id: row.id,
    salesforceContactId: row.salesforceContactId,
    displayName: row.displayName,
    primaryEmail: row.primaryEmail,
    primaryPhone: row.primaryPhone,
    salesforceDeletedAt: fromDate(row.salesforceDeletedAt ?? null),
    salesforceReconciledAt: fromDate(row.salesforceReconciledAt ?? null),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapContactToInsert(
  record: ContactRecord,
): typeof contacts.$inferInsert {
  const parsed = contactSchema.parse(record);

  return {
    id: parsed.id,
    salesforceContactId: parsed.salesforceContactId,
    displayName: parsed.displayName,
    primaryEmail: parsed.primaryEmail,
    primaryPhone: parsed.primaryPhone,
    salesforceDeletedAt:
      parsed.salesforceDeletedAt === undefined
        ? undefined
        : parsed.salesforceDeletedAt === null
          ? null
          : toDate(parsed.salesforceDeletedAt),
    salesforceReconciledAt:
      parsed.salesforceReconciledAt === undefined
        ? undefined
        : parsed.salesforceReconciledAt === null
          ? null
          : toDate(parsed.salesforceReconciledAt),
    createdAt: toDate(parsed.createdAt),
    updatedAt: toDate(parsed.updatedAt),
  };
}

export function mapContactIdentityRow(
  row: ContactIdentityRow,
): ContactIdentityRecord {
  return contactIdentitySchema.parse({
    id: row.id,
    contactId: row.contactId,
    kind: row.kind,
    normalizedValue: row.normalizedValue,
    isPrimary: row.isPrimary,
    source: row.source,
    verifiedAt: fromDate(row.verifiedAt),
  });
}

export function mapContactIdentityToInsert(
  record: ContactIdentityRecord,
): typeof contactIdentities.$inferInsert {
  const parsed = contactIdentitySchema.parse(record);

  return {
    id: parsed.id,
    contactId: parsed.contactId,
    kind: parsed.kind,
    normalizedValue: parsed.normalizedValue,
    isPrimary: parsed.isPrimary,
    source: parsed.source,
    verifiedAt: parsed.verifiedAt === null ? null : toDate(parsed.verifiedAt),
  };
}

export function mapContactMembershipRow(
  row: ContactMembershipRowInput,
): ContactMembershipRecord {
  return contactMembershipSchema.parse({
    id: row.id,
    contactId: row.contactId,
    projectId: row.projectId,
    expeditionId: row.expeditionId,
    salesforceMembershipId: row.salesforceMembershipId ?? undefined,
    role: row.role,
    status: row.status,
    source: row.source,
    salesforceDeletedAt: fromDate(row.salesforceDeletedAt ?? null),
    salesforceReconciledAt: fromDate(row.salesforceReconciledAt ?? null),
    createdAt: row.createdAt.toISOString(),
  });
}

export function mapContactMembershipToInsert(
  record: ContactMembershipRecord,
): typeof contactMemberships.$inferInsert {
  const parsed = contactMembershipSchema.parse(record);

  return {
    id: parsed.id,
    contactId: parsed.contactId,
    projectId: parsed.projectId,
    expeditionId: parsed.expeditionId,
    salesforceMembershipId: parsed.salesforceMembershipId ?? null,
    role: parsed.role,
    status: parsed.status,
    source: parsed.source,
    salesforceDeletedAt:
      parsed.salesforceDeletedAt === undefined
        ? undefined
        : parsed.salesforceDeletedAt === null
          ? null
          : toDate(parsed.salesforceDeletedAt),
    salesforceReconciledAt:
      parsed.salesforceReconciledAt === undefined
        ? undefined
        : parsed.salesforceReconciledAt === null
          ? null
          : toDate(parsed.salesforceReconciledAt),
    createdAt: toDate(parsed.createdAt),
  };
}

export function mapSmsMessageRow(row: SmsMessageRow): SmsMessageRecord {
  return {
    id: row.id,
    twilioMessageSid: row.twilioMessageSid,
    direction: row.direction as SmsMessageRecord["direction"],
    contactId: row.contactId,
    phoneE164: row.phoneE164,
    senderId: row.senderId,
    broadcastRunId: row.broadcastRunId,
    body: row.body,
    segments: row.segments,
    encoding: row.encoding as SmsMessageRecord["encoding"],
    mediaUrls: row.mediaUrls,
    sendStatus: row.sendStatus,
    failedReason: row.failedReason,
    failedDetail: row.failedDetail,
    sentAt: row.sentAt,
    receivedAt: row.receivedAt,
    actorId: row.actorId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapSmsMessageToInsert(
  record: SmsMessageRecord,
): typeof smsMessages.$inferInsert {
  return {
    id: record.id,
    twilioMessageSid: record.twilioMessageSid,
    direction: record.direction,
    contactId: record.contactId,
    phoneE164: record.phoneE164,
    senderId: record.senderId,
    broadcastRunId: record.broadcastRunId,
    body: record.body,
    segments: record.segments,
    encoding: record.encoding,
    mediaUrls: record.mediaUrls === null ? null : [...record.mediaUrls],
    sendStatus: record.sendStatus,
    failedReason: record.failedReason,
    failedDetail: record.failedDetail,
    sentAt: record.sentAt,
    receivedAt: record.receivedAt,
    actorId: record.actorId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function mapConsentRecordRow(row: ConsentRecordRow): ConsentRecord {
  return {
    id: row.id,
    contactId: row.contactId,
    phoneE164: row.phoneE164,
    status: row.status as ConsentRecord["status"],
    source: row.source as ConsentRecord["source"],
    sourceDetail: row.sourceDetail,
    consentedAt: row.consentedAt,
    revokedAt: row.revokedAt,
    recordedByUserId: row.recordedByUserId,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapConsentRecordToInsert(
  record: ConsentRecord,
): typeof consentRecords.$inferInsert {
  return {
    id: record.id,
    contactId: record.contactId,
    phoneE164: record.phoneE164,
    status: record.status,
    source: record.source,
    sourceDetail: record.sourceDetail,
    consentedAt: record.consentedAt,
    revokedAt: record.revokedAt,
    recordedByUserId: record.recordedByUserId,
    notes: record.notes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function mapSmsSenderRow(row: SmsSenderRow): SmsSenderRecord {
  return {
    id: row.id,
    phoneE164: row.phoneE164,
    displayName: row.displayName,
    monthlyCap: row.monthlyCap,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapSmsSenderToInsert(
  record: SmsSenderRecord,
): typeof smsSenders.$inferInsert {
  return {
    id: record.id,
    phoneE164: record.phoneE164,
    displayName: record.displayName,
    monthlyCap: record.monthlyCap,
    isActive: record.isActive,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function mapProjectDimensionRow(
  row: ProjectDimensionRowInput,
): ProjectDimensionRecord {
  return projectDimensionSchema.parse({
    projectId: row.projectId,
    projectName: row.projectName,
    projectAlias: row.projectAlias,
    previousAliases: row.previousAliases,
    connectedToProjectId: row.connectedToProjectId,
    source: row.source,
    isActive: row.isActive,
    aiKnowledgeUrl: row.aiKnowledgeUrl,
    aiKnowledgeSyncedAt: fromDate(row.aiKnowledgeSyncedAt),
    aiKnowledgeSources: aiKnowledgeSourcesSchema.parse(row.aiKnowledgeSources),
    aiOperatingContext: row.aiOperatingContext,
    aiAutoSyncSchedule: row.aiAutoSyncSchedule,
    aiOptimizedSynthesizedAt: fromDate(row.aiOptimizedSynthesizedAt),
    aiOptimizedLastCheckedAt: fromDate(row.aiOptimizedLastCheckedAt),
    aiOptimizedInputHash: row.aiOptimizedInputHash,
    salesforceDeletedAt: fromDate(row.salesforceDeletedAt ?? null),
    salesforceReconciledAt: fromDate(row.salesforceReconciledAt ?? null),
  });
}

export function mapProjectDimensionToInsert(
  record: ProjectDimensionRecord,
): typeof projectDimensions.$inferInsert {
  const parsed = projectDimensionSchema.parse(record);

  return {
    projectId: parsed.projectId,
    projectName: parsed.projectName,
    projectAlias: parsed.projectAlias ?? null,
    // connectedToProjectId is operator-managed; absent in incoming records
    // means "don't set it" (mirrors projectAlias behaviour). Salesforce
    // capture never sets this — only Settings/admin actions should.
    connectedToProjectId: parsed.connectedToProjectId ?? null,
    isActive: parsed.isActive ?? false,
    aiKnowledgeUrl: parsed.aiKnowledgeUrl ?? null,
    aiKnowledgeSyncedAt:
      parsed.aiKnowledgeSyncedAt === undefined ||
      parsed.aiKnowledgeSyncedAt === null
        ? null
        : toDate(parsed.aiKnowledgeSyncedAt),
    aiKnowledgeSources: parsed.aiKnowledgeSources ?? undefined,
    aiOperatingContext: parsed.aiOperatingContext ?? undefined,
    aiAutoSyncSchedule: parsed.aiAutoSyncSchedule,
    aiOptimizedSynthesizedAt:
      parsed.aiOptimizedSynthesizedAt === undefined
        ? undefined
        : parsed.aiOptimizedSynthesizedAt === null
          ? null
          : toDate(parsed.aiOptimizedSynthesizedAt),
    aiOptimizedLastCheckedAt:
      parsed.aiOptimizedLastCheckedAt === undefined
        ? undefined
        : parsed.aiOptimizedLastCheckedAt === null
          ? null
          : toDate(parsed.aiOptimizedLastCheckedAt),
    aiOptimizedInputHash:
      parsed.aiOptimizedInputHash === undefined
        ? undefined
        : parsed.aiOptimizedInputHash,
    salesforceDeletedAt:
      parsed.salesforceDeletedAt === undefined
        ? undefined
        : parsed.salesforceDeletedAt === null
          ? null
          : toDate(parsed.salesforceDeletedAt),
    salesforceReconciledAt:
      parsed.salesforceReconciledAt === undefined
        ? undefined
        : parsed.salesforceReconciledAt === null
          ? null
          : toDate(parsed.salesforceReconciledAt),
    source: parsed.source,
  };
}

export function mapIntegrationHealthRow(
  row: IntegrationHealthRow,
): IntegrationHealthRecord {
  return integrationHealthSchema.parse({
    id: row.id,
    serviceName: row.serviceName,
    category: row.category,
    status: row.status,
    lastCheckedAt: fromDate(row.lastCheckedAt),
    degradedSinceAt: fromDate(row.degradedSinceAt),
    lastAlertSentAt: fromDate(row.lastAlertSentAt),
    detail: row.detail,
    metadataJson: row.metadataJson,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapIntegrationHealthToInsert(
  record: IntegrationHealthRecord,
): typeof integrationHealth.$inferInsert {
  const parsed = integrationHealthSchema.parse(record);

  return {
    id: parsed.id,
    serviceName: parsed.serviceName,
    category: parsed.category,
    status: parsed.status,
    lastCheckedAt:
      parsed.lastCheckedAt === null ? null : toDate(parsed.lastCheckedAt),
    degradedSinceAt:
      parsed.degradedSinceAt === null ? null : toDate(parsed.degradedSinceAt),
    lastAlertSentAt:
      parsed.lastAlertSentAt === null ? null : toDate(parsed.lastAlertSentAt),
    detail: parsed.detail,
    metadataJson: parsed.metadataJson,
    createdAt: toDate(parsed.createdAt),
    updatedAt: toDate(parsed.updatedAt),
  };
}

export function mapExpeditionDimensionRow(
  row: ExpeditionDimensionRow,
): ExpeditionDimensionRecord {
  return expeditionDimensionSchema.parse({
    expeditionId: row.expeditionId,
    projectId: row.projectId,
    expeditionName: row.expeditionName,
    source: row.source,
  });
}

export function mapExpeditionDimensionToInsert(
  record: ExpeditionDimensionRecord,
): typeof expeditionDimensions.$inferInsert {
  const parsed = expeditionDimensionSchema.parse(record);

  return {
    expeditionId: parsed.expeditionId,
    projectId: parsed.projectId,
    expeditionName: parsed.expeditionName,
    source: parsed.source,
  };
}

export function mapGmailMessageDetailRow(
  row: GmailMessageDetailRow,
): GmailMessageDetailRecord {
  return gmailMessageDetailSchema.parse({
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    gmailThreadId: row.gmailThreadId,
    rfc822MessageId: row.rfc822MessageId,
    direction: row.direction,
    subject: row.subject,
    fromHeader: row.fromHeader,
    toHeader: row.toHeader,
    ccHeader: row.ccHeader,
    fromEmails: row.fromEmails,
    toEmails: row.toEmails,
    ccEmails: row.ccEmails,
    bccEmails: row.bccEmails,
    labelIds: row.labelIds,
    snippetClean: row.snippetClean,
    bodyTextPreview: row.bodyTextPreview,
    bodyKind: row.bodyKind,
    capturedMailbox: row.capturedMailbox,
    projectInboxAlias: row.projectInboxAlias,
  });
}

export function mapGmailMessageDetailToInsert(
  record: GmailMessageDetailRecord,
): typeof gmailMessageDetails.$inferInsert {
  const parsed = gmailMessageDetailSchema.parse(record);

  return {
    sourceEvidenceId: parsed.sourceEvidenceId,
    providerRecordId: parsed.providerRecordId,
    gmailThreadId: parsed.gmailThreadId,
    rfc822MessageId: parsed.rfc822MessageId,
    direction: parsed.direction,
    subject: parsed.subject,
    fromHeader: parsed.fromHeader,
    toHeader: parsed.toHeader,
    ccHeader: parsed.ccHeader,
    fromEmails: [...parsed.fromEmails],
    toEmails: [...parsed.toEmails],
    ccEmails: [...parsed.ccEmails],
    bccEmails: [...parsed.bccEmails],
    labelIds: parsed.labelIds,
    snippetClean: parsed.snippetClean,
    bodyTextPreview: parsed.bodyTextPreview,
    bodyKind: parsed.bodyKind ?? null,
    capturedMailbox: parsed.capturedMailbox,
    projectInboxAlias: parsed.projectInboxAlias,
  };
}

export function mapMessageAttachmentRow(
  row: MessageAttachmentRow,
): MessageAttachmentRecord {
  return messageAttachmentSchema.parse({
    id: row.id,
    sourceEvidenceId: row.sourceEvidenceId,
    provider: row.provider,
    gmailAttachmentId: row.gmailAttachmentId,
    mimeType: row.mimeType,
    filename: row.filename,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    externalUrl: row.externalUrl,
    isDecoration: row.isDecoration,
    createdAt: row.createdAt.toISOString(),
  });
}

export function mapMessageAttachmentToInsert(
  record: MessageAttachmentRecord,
): typeof messageAttachments.$inferInsert {
  const parsed = messageAttachmentSchema.parse(record);

  return {
    id: parsed.id,
    sourceEvidenceId: parsed.sourceEvidenceId,
    provider: parsed.provider,
    gmailAttachmentId: parsed.gmailAttachmentId,
    mimeType: parsed.mimeType,
    filename: parsed.filename,
    sizeBytes: parsed.sizeBytes,
    storageKey: parsed.storageKey,
    externalUrl: parsed.externalUrl,
    isDecoration: parsed.isDecoration,
    createdAt: toDate(parsed.createdAt),
  };
}

export function mapSalesforceEventContextRow(
  row: SalesforceEventContextRow,
): SalesforceEventContextRecord {
  return salesforceEventContextSchema.parse({
    sourceEvidenceId: row.sourceEvidenceId,
    salesforceContactId: row.salesforceContactId,
    projectId: row.projectId,
    expeditionId: row.expeditionId,
    sourceField: row.sourceField,
  });
}

export function mapSalesforceEventContextToInsert(
  record: SalesforceEventContextRecord,
): typeof salesforceEventContext.$inferInsert {
  const parsed = salesforceEventContextSchema.parse(record);

  return {
    sourceEvidenceId: parsed.sourceEvidenceId,
    salesforceContactId: parsed.salesforceContactId,
    projectId: parsed.projectId,
    expeditionId: parsed.expeditionId,
    sourceField: parsed.sourceField,
  };
}

export function mapSalesforceCommunicationDetailRow(
  row: SalesforceCommunicationDetailRow,
): SalesforceCommunicationDetailRecord {
  return salesforceCommunicationDetailSchema.parse({
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    channel: row.channel,
    messageKind: row.messageKind,
    subject: row.subject,
    snippet: row.snippet,
    sourceLabel: row.sourceLabel,
  });
}

export function mapSalesforceCommunicationDetailToInsert(
  record: SalesforceCommunicationDetailRecord,
): typeof salesforceCommunicationDetails.$inferInsert {
  const parsed = salesforceCommunicationDetailSchema.parse(record);

  return {
    sourceEvidenceId: parsed.sourceEvidenceId,
    providerRecordId: parsed.providerRecordId,
    channel: parsed.channel,
    messageKind: parsed.messageKind,
    subject: parsed.subject,
    snippet: parsed.snippet,
    sourceLabel: parsed.sourceLabel,
  };
}

export function mapSimpleTextingMessageDetailRow(
  row: SimpleTextingMessageDetailRow,
): SimpleTextingMessageDetailRecord {
  return simpleTextingMessageDetailSchema.parse({
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    direction: row.direction,
    messageKind: row.messageKind,
    messageTextPreview: row.messageTextPreview,
    normalizedPhone: row.normalizedPhone,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    providerThreadId: row.providerThreadId,
    threadKey: row.threadKey,
  });
}

export function mapSimpleTextingMessageDetailToInsert(
  record: SimpleTextingMessageDetailRecord,
): typeof simpleTextingMessageDetails.$inferInsert {
  const parsed = simpleTextingMessageDetailSchema.parse(record);

  return {
    sourceEvidenceId: parsed.sourceEvidenceId,
    providerRecordId: parsed.providerRecordId,
    direction: parsed.direction,
    messageKind: parsed.messageKind,
    messageTextPreview: parsed.messageTextPreview,
    normalizedPhone: parsed.normalizedPhone,
    campaignId: parsed.campaignId,
    campaignName: parsed.campaignName,
    providerThreadId: parsed.providerThreadId,
    threadKey: parsed.threadKey,
  };
}

export function mapMailchimpCampaignActivityDetailRow(
  row: MailchimpCampaignActivityDetailRow,
): MailchimpCampaignActivityDetailRecord {
  return mailchimpCampaignActivityDetailSchema.parse({
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    activityType: row.activityType,
    campaignId: row.campaignId,
    audienceId: row.audienceId,
    memberId: row.memberId,
    campaignName: row.campaignName,
    snippet: row.snippet,
  });
}

export function mapMailchimpCampaignActivityDetailToInsert(
  record: MailchimpCampaignActivityDetailRecord,
): typeof mailchimpCampaignActivityDetails.$inferInsert {
  const parsed = mailchimpCampaignActivityDetailSchema.parse(record);

  return {
    sourceEvidenceId: parsed.sourceEvidenceId,
    providerRecordId: parsed.providerRecordId,
    activityType: parsed.activityType,
    campaignId: parsed.campaignId,
    audienceId: parsed.audienceId,
    memberId: parsed.memberId,
    campaignName: parsed.campaignName,
    snippet: parsed.snippet,
  };
}

export function mapManualNoteDetailRow(
  row: ManualNoteDetailRow,
): ManualNoteDetailRecord {
  return manualNoteDetailSchema.parse({
    sourceEvidenceId: row.sourceEvidenceId,
    providerRecordId: row.providerRecordId,
    body: row.body,
    authorDisplayName: row.authorDisplayName,
    authorId: row.authorId,
  });
}

export function mapManualNoteDetailToInsert(
  record: ManualNoteDetailRecord,
): typeof manualNoteDetails.$inferInsert {
  const parsed = manualNoteDetailSchema.parse(record);

  return {
    sourceEvidenceId: parsed.sourceEvidenceId,
    providerRecordId: parsed.providerRecordId,
    body: parsed.body,
    authorDisplayName: parsed.authorDisplayName,
    authorId: parsed.authorId,
  };
}

export function mapOpsDigestWatermarkRow(
  row: OpsDigestWatermarkRow,
): OpsDigestWatermarkRecord {
  return opsDigestWatermarkRecordSchema.parse({
    id: row.id,
    lastRunAt: fromDate(row.lastRunAt),
    lastDigestSentAt: fromDate(row.lastDigestSentAt),
    quietStreakStartedAt: fromDate(row.quietStreakStartedAt),
    syncStateDeadLetterCounts: row.syncStateDeadLetterCountsJson,
    reportedDependencyAdvisoryIds: row.reportedDependencyAdvisoryIdsJson,
    postmarkWebhookDeadLetter:
      row.lastSeenPostmarkWebhookDeadLetterReceivedAt === null ||
      row.lastSeenPostmarkWebhookDeadLetterId === null
        ? null
        : {
            id: row.lastSeenPostmarkWebhookDeadLetterId,
            timestamp:
              row.lastSeenPostmarkWebhookDeadLetterReceivedAt.toISOString(),
          },
    identityResolutionQueue:
      row.lastSeenIdentityResolutionOpenedAt === null ||
      row.lastSeenIdentityResolutionCaseId === null
        ? null
        : {
            id: row.lastSeenIdentityResolutionCaseId,
            timestamp: row.lastSeenIdentityResolutionOpenedAt.toISOString(),
          },
    routingReviewQueue:
      row.lastSeenRoutingReviewOpenedAt === null ||
      row.lastSeenRoutingReviewCaseId === null
        ? null
        : {
            id: row.lastSeenRoutingReviewCaseId,
            timestamp: row.lastSeenRoutingReviewOpenedAt.toISOString(),
          },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapOpsDigestWatermarkToInsert(
  record: OpsDigestWatermarkRecord,
): typeof opsDigestWatermark.$inferInsert {
  const parsed = opsDigestWatermarkRecordSchema.parse(record);

  return {
    id: parsed.id,
    lastRunAt: parsed.lastRunAt === null ? null : toDate(parsed.lastRunAt),
    lastDigestSentAt:
      parsed.lastDigestSentAt === null ? null : toDate(parsed.lastDigestSentAt),
    quietStreakStartedAt:
      parsed.quietStreakStartedAt === null
        ? null
        : toDate(parsed.quietStreakStartedAt),
    syncStateDeadLetterCountsJson: parsed.syncStateDeadLetterCounts,
    reportedDependencyAdvisoryIdsJson: parsed.reportedDependencyAdvisoryIds,
    lastSeenPostmarkWebhookDeadLetterReceivedAt:
      parsed.postmarkWebhookDeadLetter === null
        ? null
        : toDate(parsed.postmarkWebhookDeadLetter.timestamp),
    lastSeenPostmarkWebhookDeadLetterId:
      parsed.postmarkWebhookDeadLetter?.id ?? null,
    lastSeenIdentityResolutionOpenedAt:
      parsed.identityResolutionQueue === null
        ? null
        : toDate(parsed.identityResolutionQueue.timestamp),
    lastSeenIdentityResolutionCaseId:
      parsed.identityResolutionQueue?.id ?? null,
    lastSeenRoutingReviewOpenedAt:
      parsed.routingReviewQueue === null
        ? null
        : toDate(parsed.routingReviewQueue.timestamp),
    lastSeenRoutingReviewCaseId: parsed.routingReviewQueue?.id ?? null,
    createdAt: toDate(parsed.createdAt),
    updatedAt: toDate(parsed.updatedAt),
  };
}

export function mapDependencyAuditSummaryRow(
  row: DependencyAuditSummaryRow,
): DependencyAuditSummaryRecord {
  return dependencyAuditSummaryRecordSchema.parse({
    id: row.id,
    generatedAt: row.generatedAt.toISOString(),
    exitStatus: row.exitStatus,
    advisories: row.advisoriesJson,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapDependencyAuditSummaryToInsert(
  record: DependencyAuditSummaryRecord,
): typeof dependencyAuditSummary.$inferInsert {
  const parsed = dependencyAuditSummaryRecordSchema.parse(record);

  return {
    id: parsed.id,
    generatedAt: toDate(parsed.generatedAt),
    exitStatus: parsed.exitStatus,
    advisoriesJson: parsed.advisories,
    createdAt: toDate(parsed.createdAt),
    updatedAt: toDate(parsed.updatedAt),
  };
}

export function mapIdentityResolutionRow(
  row: IdentityResolutionRow,
): IdentityResolutionCase {
  return identityResolutionSchema.parse({
    id: row.id,
    sourceEvidenceId: row.sourceEvidenceId,
    candidateContactIds: row.candidateContactIds,
    reasonCode: row.reasonCode,
    status: row.status,
    openedAt: row.openedAt.toISOString(),
    resolvedAt: fromDate(row.resolvedAt),
    lastAttemptedAt: fromDate(row.lastAttemptedAt),
    normalizedIdentityValues: row.normalizedIdentityValues,
    anchoredContactId: row.anchoredContactId,
    explanation: row.explanation,
  });
}

export function mapIdentityResolutionToInsert(
  record: IdentityResolutionCase,
): typeof identityResolutionQueue.$inferInsert {
  const parsed = identityResolutionSchema.parse(record);

  return {
    id: parsed.id,
    sourceEvidenceId: parsed.sourceEvidenceId,
    candidateContactIds: [...parsed.candidateContactIds],
    reasonCode: parsed.reasonCode,
    status: parsed.status,
    openedAt: toDate(parsed.openedAt),
    resolvedAt: parsed.resolvedAt === null ? null : toDate(parsed.resolvedAt),
    lastAttemptedAt:
      parsed.lastAttemptedAt == null ? null : toDate(parsed.lastAttemptedAt),
    normalizedIdentityValues: [...parsed.normalizedIdentityValues],
    anchoredContactId: parsed.anchoredContactId,
    explanation: parsed.explanation,
  };
}

export function mapRoutingReviewRow(row: RoutingReviewRow): RoutingReviewCase {
  return routingReviewSchema.parse({
    id: row.id,
    contactId: row.contactId,
    sourceEvidenceId: row.sourceEvidenceId,
    reasonCode: row.reasonCode,
    status: row.status,
    openedAt: row.openedAt.toISOString(),
    resolvedAt: fromDate(row.resolvedAt),
    candidateMembershipIds: row.candidateMembershipIds,
    explanation: row.explanation,
  });
}

export function mapRoutingReviewToInsert(
  record: RoutingReviewCase,
): typeof routingReviewQueue.$inferInsert {
  const parsed = routingReviewSchema.parse(record);

  return {
    id: parsed.id,
    contactId: parsed.contactId,
    sourceEvidenceId: parsed.sourceEvidenceId,
    reasonCode: parsed.reasonCode,
    status: parsed.status,
    openedAt: toDate(parsed.openedAt),
    resolvedAt: parsed.resolvedAt === null ? null : toDate(parsed.resolvedAt),
    candidateMembershipIds: [...parsed.candidateMembershipIds],
    explanation: parsed.explanation,
  };
}

export function mapInboxProjectionRow(
  row: InboxProjectionRowDb,
): InboxProjectionRow {
  return inboxProjectionSchema.parse({
    contactId: row.contactId,
    bucket: row.bucket,
    needsFollowUp: row.isStarred,
    hasUnresolved: row.hasUnresolved,
    lastInboundAt: fromDate(row.lastInboundAt),
    lastOutboundAt: fromDate(row.lastOutboundAt),
    lastActivityAt: row.lastActivityAt.toISOString(),
    snippet: row.snippet,
    archivedAt: fromDate(row.archivedAt),
    lastCanonicalEventId: row.lastCanonicalEventId,
    lastEventType: row.lastEventType,
  });
}

export function mapInboxProjectionToInsert(
  record: InboxProjectionRow,
): typeof contactInboxProjection.$inferInsert {
  const parsed = inboxProjectionSchema.parse(record);

  return {
    contactId: parsed.contactId,
    bucket: parsed.bucket,
    isStarred: parsed.needsFollowUp,
    hasUnresolved: parsed.hasUnresolved,
    lastInboundAt:
      parsed.lastInboundAt === null ? null : toDate(parsed.lastInboundAt),
    lastOutboundAt:
      parsed.lastOutboundAt === null ? null : toDate(parsed.lastOutboundAt),
    lastActivityAt: toDate(parsed.lastActivityAt),
    snippet: parsed.snippet,
    archivedAt: parsed.archivedAt === null ? null : toDate(parsed.archivedAt),
    lastCanonicalEventId: parsed.lastCanonicalEventId,
    lastEventType: parsed.lastEventType,
  };
}

export function mapTimelineProjectionRow(
  row: TimelineProjectionRowDb,
): TimelineProjectionRow {
  return timelineProjectionSchema.parse({
    id: row.id,
    contactId: row.contactId,
    canonicalEventId: row.canonicalEventId,
    occurredAt: row.occurredAt.toISOString(),
    sortKey: row.sortKey,
    eventType: row.eventType,
    summary: row.summary,
    channel: row.channel,
    primaryProvider: row.primaryProvider,
    reviewState: row.reviewState,
  });
}

export function mapTimelineProjectionToInsert(
  record: TimelineProjectionRow,
): typeof contactTimelineProjection.$inferInsert {
  const parsed = timelineProjectionSchema.parse(record);

  return {
    id: parsed.id,
    contactId: parsed.contactId,
    canonicalEventId: parsed.canonicalEventId,
    occurredAt: toDate(parsed.occurredAt),
    sortKey: parsed.sortKey,
    eventType: parsed.eventType,
    summary: parsed.summary,
    channel: parsed.channel,
    primaryProvider: parsed.primaryProvider,
    reviewState: parsed.reviewState,
  };
}

export function mapSyncStateRow(row: SyncStateRow): SyncStateRecord {
  return syncStateSchema.parse({
    id: row.id,
    scope: row.scope,
    provider: row.provider,
    jobType: row.jobType,
    cursor: row.cursor,
    windowStart: fromDate(row.windowStart),
    windowEnd: fromDate(row.windowEnd),
    status: row.status,
    parityPercent:
      row.parityPercent === null ? null : Number.parseFloat(row.parityPercent),
    freshnessP95Seconds: row.freshnessP95Seconds,
    freshnessP99Seconds: row.freshnessP99Seconds,
    lastSuccessfulAt: fromDate(row.lastSuccessfulAt),
    consecutiveFailureCount: row.consecutiveFailureCount,
    leaseOwner: row.leaseOwner,
    heartbeatAt: fromDate(row.heartbeatAt),
    deadLetterCount: row.deadLetterCount,
  });
}

export function mapSyncStateToInsert(
  record: SyncStateRecord,
): typeof syncState.$inferInsert {
  const parsed = syncStateSchema.parse(record);

  return {
    id: parsed.id,
    scope: parsed.scope,
    provider: parsed.provider,
    jobType: parsed.jobType,
    cursor: parsed.cursor,
    windowStart:
      parsed.windowStart === null ? null : toDate(parsed.windowStart),
    windowEnd: parsed.windowEnd === null ? null : toDate(parsed.windowEnd),
    status: parsed.status,
    parityPercent:
      parsed.parityPercent === null ? null : parsed.parityPercent.toString(),
    freshnessP95Seconds: parsed.freshnessP95Seconds,
    freshnessP99Seconds: parsed.freshnessP99Seconds,
    lastSuccessfulAt:
      parsed.lastSuccessfulAt === null ? null : toDate(parsed.lastSuccessfulAt),
    consecutiveFailureCount: parsed.consecutiveFailureCount,
    leaseOwner: parsed.leaseOwner,
    heartbeatAt: parsed.heartbeatAt === null ? null : toDate(parsed.heartbeatAt),
    deadLetterCount: parsed.deadLetterCount,
  };
}

export function mapAuditEvidenceRow(
  row: AuditEvidenceRow,
): AuditEvidenceRecord {
  return auditEvidenceSchema.parse({
    id: row.id,
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    occurredAt: row.occurredAt.toISOString(),
    result: row.result,
    policyCode: row.policyCode,
    metadataJson: row.metadataJson,
  });
}

export function mapAuditEvidenceToInsert(
  record: AuditEvidenceRecord,
): typeof auditPolicyEvidence.$inferInsert {
  const parsed = auditEvidenceSchema.parse(record);

  return {
    id: parsed.id,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: parsed.action,
    entityType: parsed.entityType,
    entityId: parsed.entityId,
    occurredAt: toDate(parsed.occurredAt),
    result: parsed.result,
    policyCode: parsed.policyCode,
    metadataJson: parsed.metadataJson,
  };
}

export function mapUserRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image,
    role: row.role,
    deactivatedAt: row.deactivatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapUserToInsert(record: UserRecord): typeof users.$inferInsert {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    emailVerified: record.emailVerified,
    image: record.image,
    role: record.role,
    deactivatedAt: record.deactivatedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function mapPendingComposerOutboundRow(
  row: PendingComposerOutboundRow,
): PendingComposerOutboundRecord {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    status: row.status,
    actorId: row.actorId,
    canonicalContactId: row.canonicalContactId,
    projectId: row.projectId,
    fromAlias: row.fromAlias,
    toEmailNormalized: row.toEmailNormalized,
    subject: row.subject,
    bodyPlaintext: row.bodyPlaintext,
    bodyHtml: row.bodyHtml,
    bodySha256: row.bodySha256,
    attachmentMetadata: row.attachmentMetadataJson,
    gmailThreadId: row.gmailThreadId,
    inReplyToRfc822: row.inReplyToRfc822,
    attemptedAt: row.attemptedAt.toISOString(),
    reconciledEventId: row.reconciledEventId,
    reconciledAt: fromDate(row.reconciledAt),
    failedReason: row.failedReason,
    sentRfc822MessageId: row.sentRfc822MessageId,
    failedDetail: row.failedDetail,
    orphanedAt: fromDate(row.orphanedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapPendingComposerOutboundToInsert(
  record: PendingComposerOutboundRecord,
): typeof pendingComposerOutbounds.$inferInsert {
  return {
    id: record.id,
    fingerprint: record.fingerprint,
    status: record.status,
    actorId: record.actorId,
    canonicalContactId: record.canonicalContactId,
    projectId: record.projectId,
    fromAlias: record.fromAlias,
    toEmailNormalized: record.toEmailNormalized,
    subject: record.subject,
    bodyPlaintext: record.bodyPlaintext,
    bodyHtml: record.bodyHtml,
    bodySha256: record.bodySha256,
    attachmentMetadataJson: record.attachmentMetadata,
    gmailThreadId: record.gmailThreadId,
    inReplyToRfc822: record.inReplyToRfc822,
    attemptedAt: toDate(record.attemptedAt),
    reconciledEventId: record.reconciledEventId,
    reconciledAt:
      record.reconciledAt === null ? null : toDate(record.reconciledAt),
    failedReason: record.failedReason,
    sentRfc822MessageId: record.sentRfc822MessageId,
    failedDetail: record.failedDetail,
    orphanedAt: record.orphanedAt === null ? null : toDate(record.orphanedAt),
    createdAt: toDate(record.createdAt),
    updatedAt: toDate(record.updatedAt),
  };
}

export function mapIntegrationBackfillJobRow(
  row: IntegrationBackfillJobRow,
): IntegrationBackfillJobRecord {
  return integrationBackfillJobSchema.parse({
    id: row.id,
    service: row.service,
    idempotencyKey: row.idempotencyKey,
    triggeredBy: row.triggeredBy,
    windowStart: row.windowStart.toISOString(),
    windowEnd: row.windowEnd.toISOString(),
    mailbox: row.mailbox,
    status: row.status,
    enqueuedAt: row.enqueuedAt.toISOString(),
    startedAt: fromDate(row.startedAt),
    completedAt: fromDate(row.completedAt),
    resultJson: row.resultJson,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapIntegrationBackfillJobToInsert(
  record: IntegrationBackfillJobRecord,
): typeof integrationBackfillJobs.$inferInsert {
  const parsed = integrationBackfillJobSchema.parse(record);

  return {
    id: parsed.id,
    service: parsed.service,
    idempotencyKey: parsed.idempotencyKey,
    triggeredBy: parsed.triggeredBy,
    windowStart: toDate(parsed.windowStart),
    windowEnd: toDate(parsed.windowEnd),
    mailbox: parsed.mailbox,
    status: parsed.status,
    enqueuedAt: toDate(parsed.enqueuedAt),
    startedAt: parsed.startedAt === null ? null : toDate(parsed.startedAt),
    completedAt:
      parsed.completedAt === null ? null : toDate(parsed.completedAt),
    resultJson: parsed.resultJson,
    failureReason: parsed.failureReason,
    createdAt: toDate(parsed.createdAt),
    updatedAt: toDate(parsed.updatedAt),
  };
}

export function mapProjectAliasRow(row: ProjectAliasRow): ProjectAliasRecord {
  return {
    id: row.id,
    alias: row.alias,
    signature: row.signature,
    projectId: row.projectId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}

export function mapProjectAliasToInsert(
  record: ProjectAliasRecord,
): typeof projectAliases.$inferInsert {
  return {
    id: record.id,
    alias: record.alias,
    signature: record.signature,
    projectId: record.projectId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
  };
}

export function mapSalesforceReconciliationRunRow(
  row: SalesforceReconciliationRunRow,
): SalesforceReconciliationRunRecord {
  return salesforceReconciliationRunSchema.parse({
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    completedAt: fromDate(row.completedAt),
    mode: row.mode,
    entityType: row.entityType,
    scanned: row.scanned,
    confirmedPresent: row.confirmedPresent,
    markedDeleted: row.markedDeleted,
    missingLocallyCount: row.missingLocallyCount,
    errors: row.errors,
    abortedReason: row.abortedReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function mapSalesforceReconciliationRunToInsert(
  record: SalesforceReconciliationRunRecord,
): typeof salesforceReconciliationRuns.$inferInsert {
  const parsed = salesforceReconciliationRunSchema.parse(record);

  return {
    id: parsed.id,
    startedAt: toDate(parsed.startedAt),
    completedAt:
      parsed.completedAt === null ? null : toDate(parsed.completedAt),
    mode: parsed.mode,
    entityType: parsed.entityType,
    scanned: parsed.scanned,
    confirmedPresent: parsed.confirmedPresent,
    markedDeleted: parsed.markedDeleted,
    missingLocallyCount: parsed.missingLocallyCount,
    errors: parsed.errors,
    abortedReason: parsed.abortedReason,
    createdAt: toDate(parsed.createdAt),
    updatedAt: toDate(parsed.updatedAt),
  };
}
