export const pendingOutboundStatusValues = [
  "pending",
  "confirmed",
  "failed",
  "orphaned",
  "superseded",
] as const;

export type PendingOutboundStatus = (typeof pendingOutboundStatusValues)[number];

export interface PendingComposerOutboundAttachmentMetadata {
  readonly filename: string;
  readonly size: number;
  readonly contentType: string;
}

export interface PendingComposerOutboundRecord {
  readonly id: string;
  readonly fingerprint: string;
  readonly status: PendingOutboundStatus;
  readonly actorId: string;
  readonly canonicalContactId: string;
  readonly projectId: string | null;
  readonly fromAlias: string;
  readonly toEmailNormalized: string;
  readonly subject: string;
  readonly bodyPlaintext: string;
  readonly bodyHtml: string | null;
  readonly bodySha256: string;
  readonly attachmentMetadata: readonly PendingComposerOutboundAttachmentMetadata[];
  readonly gmailThreadId: string | null;
  readonly inReplyToRfc822: string | null;
  readonly sentAt: string;
  readonly reconciledEventId: string | null;
  readonly reconciledAt: string | null;
  readonly failedReason: string | null;
  readonly sentRfc822MessageId: string | null;
  readonly failedDetail: string | null;
  readonly orphanedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
