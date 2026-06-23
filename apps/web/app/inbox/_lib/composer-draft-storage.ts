import type {
  ComposerDraftChannel,
  ComposerDraftForwardContext,
  ComposerDraftRecipientKind,
} from "@as-comms/contracts";
import type { ComposerDraftPaneMode, ComposerDraftRecord } from "@as-comms/db";

export interface StoredComposerDraft {
  readonly id?: string;
  readonly paneMode?: ComposerDraftPaneMode;
  readonly channel?: ComposerDraftChannel;
  readonly recipientAnchorKind?: ComposerDraftRecipientKind | null;
  readonly recipientContactId?: string | null;
  readonly recipientEmail?: string | null;
  readonly recipientPhone?: string | null;
  readonly subject: string;
  readonly bodyPlaintext: string;
  readonly bodyHtml: string;
  readonly selectedAlias: string | null;
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly attachments: readonly {
    readonly filename: string;
    readonly size: number;
    readonly contentType: string;
  }[];
  readonly updatedAt: number;
  readonly aiDirective?: string;
  readonly replyContextThreadCursor?: string | null;
  readonly forwardContext?: ComposerDraftForwardContext | null;
}

export function toStoredComposerDraft(
  draft: ComposerDraftRecord,
): StoredComposerDraft {
  return {
    id: draft.id,
    paneMode: draft.paneMode,
    channel: draft.channel,
    recipientAnchorKind: draft.recipientAnchorKind,
    recipientContactId: draft.recipientContactId,
    recipientEmail: draft.recipientEmail,
    recipientPhone: draft.recipientPhone,
    subject: draft.subject,
    bodyPlaintext: draft.bodyPlaintext,
    bodyHtml: draft.bodyHtml,
    selectedAlias: draft.selectedAlias,
    cc: draft.cc,
    bcc: draft.bcc,
    attachments: draft.attachments,
    updatedAt: Date.parse(draft.updatedAt),
    aiDirective: draft.aiDirective,
    replyContextThreadCursor: draft.replyContextThreadCursor,
    forwardContext: draft.forwardContext,
  };
}
