export type {
  AuditEvidenceRecord,
  CanonicalEventProvenance,
  CanonicalEventRecord,
  ContactIdentityRecord,
  ContactMembershipRecord,
  ContactRecord,
  IdentityResolutionCase,
  InboxProjectionRow,
  MailchimpCampaignActivityDetailRecord,
  ManualNoteDetailRecord,
  RoutingReviewCase,
  SalesforceCommunicationDetailRecord,
  SourceEvidenceRecord,
  SyncStateRecord,
  TimelineItem,
  TimelineProjectionRow
} from "@as-comms/contracts";

export type SmsDirection = "inbound" | "outbound";
export type SmsEncoding = "GSM-7" | "Unicode";
export type SmsSendStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "undelivered"
  | "received";

export interface SmsMessageRecord {
  readonly id: string;
  readonly twilioMessageSid: string | null;
  readonly direction: SmsDirection;
  readonly contactId: string;
  readonly phoneE164: string;
  readonly senderId: string;
  readonly broadcastRunId: string | null;
  readonly body: string;
  readonly segments: number;
  readonly encoding: SmsEncoding;
  readonly mediaUrls: readonly string[] | null;
  readonly sendStatus: string;
  readonly failedReason: string | null;
  readonly failedDetail: string | null;
  readonly sentAt: Date | null;
  readonly receivedAt: Date | null;
  readonly actorId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type ConsentStatus = "opted_in" | "revoked";
export type ConsentSource =
  | "volunteer_application_form"
  | "sms_reply_yes"
  | "operator_attestation"
  | "salesforce_field"
  | "inbound_thread";

export interface ConsentRecord {
  readonly id: string;
  readonly contactId: string | null;
  readonly phoneE164: string;
  readonly status: ConsentStatus;
  readonly source: ConsentSource;
  readonly sourceDetail: string | null;
  readonly consentedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly recordedByUserId: string | null;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SmsSenderRecord {
  readonly id: string;
  readonly phoneE164: string;
  readonly displayName: string;
  readonly monthlyCap: number | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
