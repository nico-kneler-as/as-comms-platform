import { sql } from "drizzle-orm";

import {
  canonicalEventLedger,
  contactInboxProjection,
  gmailMessageDetails,
  type Stage1Database,
} from "@as-comms/db";
import {
  rebuildInboxProjectionForContact,
  type Stage1PersistenceService,
} from "@as-comms/domain";
import type { GmailMailboxApiClient } from "@as-comms/integrations";

export type InboxReadState =
  | "unread_in_inbox"
  | "read_or_out_of_inbox"
  | "unknown";

export interface NewInboxReadStateCandidate {
  readonly contactId: string;
  readonly latestInboundProviderRecordId: string | null;
}

export interface PollInboxReadStateReport {
  readonly processed: number;
  readonly openedByReply: number;
  readonly openedByRead: number;
  readonly stayedNew: number;
  readonly unknown: number;
}

export type InboxReadStateReader = (input: {
  readonly gmailClient: Pick<GmailMailboxApiClient, "getMessage">;
  readonly mailbox: string;
  readonly messageId: string;
}) => Promise<InboxReadState>;

interface NewInboxReadStateCandidateRow {
  readonly contactId: string;
  readonly latestInboundProviderRecordId: string | null;
}

function normalizeSqlResultRows<TRow>(
  result:
    | readonly TRow[]
    | {
        readonly rows?: readonly TRow[];
      },
): readonly TRow[] {
  if (Array.isArray(result)) {
    return result as readonly TRow[];
  }

  return (result as { readonly rows?: readonly TRow[] }).rows ?? [];
}

export function decideInboxBucketFromReplyAndReadState(input: {
  readonly hasInThreadReply: boolean;
  readonly readState: InboxReadState;
}): "Opened" | "New" {
  if (input.hasInThreadReply) {
    return "Opened";
  }

  return input.readState === "read_or_out_of_inbox" ? "Opened" : "New";
}

export async function readGmailMessageReadState(input: {
  readonly gmailClient: Pick<GmailMailboxApiClient, "getMessage">;
  readonly mailbox: string;
  readonly messageId: string;
}): Promise<InboxReadState> {
  if (input.messageId.startsWith("mbox:")) {
    return "unknown";
  }

  try {
    const message = await input.gmailClient.getMessage({
      mailbox: input.mailbox,
      messageId: input.messageId,
    });

    if (message === null) {
      return "unknown";
    }

    const labelIds = new Set(message.labelIds);

    return labelIds.has("UNREAD") && labelIds.has("INBOX")
      ? "unread_in_inbox"
      : "read_or_out_of_inbox";
  } catch {
    return "unknown";
  }
}

export async function loadNewInboxReadStateCandidates(
  db: Stage1Database,
): Promise<readonly NewInboxReadStateCandidate[]> {
  const result = await db.execute(sql<NewInboxReadStateCandidateRow>`
    with latest_inbound as (
      select
        ${canonicalEventLedger.contactId} as contact_id,
        ${gmailMessageDetails.providerRecordId} as provider_record_id,
        row_number() over (
          partition by ${canonicalEventLedger.contactId}
          order by ${canonicalEventLedger.occurredAt} desc, ${canonicalEventLedger.id} desc
        ) as inbound_rank
      from ${canonicalEventLedger}
      join ${gmailMessageDetails}
        on ${gmailMessageDetails.sourceEvidenceId} = ${canonicalEventLedger.sourceEvidenceId}
      where ${gmailMessageDetails.direction} = 'inbound'
    )
    select
      ${contactInboxProjection.contactId} as "contactId",
      latest_inbound.provider_record_id as "latestInboundProviderRecordId"
    from ${contactInboxProjection}
    left join latest_inbound
      on latest_inbound.contact_id = ${contactInboxProjection.contactId}
     and latest_inbound.inbound_rank = 1
    where ${contactInboxProjection.bucket} = 'New'
      and ${contactInboxProjection.archivedAt} is null
    order by ${contactInboxProjection.contactId} asc
  `);

  return normalizeSqlResultRows(
    result as
      | readonly NewInboxReadStateCandidateRow[]
      | {
          readonly rows?: readonly NewInboxReadStateCandidateRow[];
        },
  );
}

export async function pollInboxReadState(input: {
  readonly db: Stage1Database;
  readonly persistence: Stage1PersistenceService;
  readonly mailbox: string;
  readonly gmailClient: Pick<GmailMailboxApiClient, "getMessage">;
  readonly readStateReader?: InboxReadStateReader;
  readonly loadCandidates?: (
    db: Stage1Database,
  ) => Promise<readonly NewInboxReadStateCandidate[]>;
}): Promise<PollInboxReadStateReport> {
  const readStateReader = input.readStateReader ?? readGmailMessageReadState;
  const loadCandidates =
    input.loadCandidates ?? loadNewInboxReadStateCandidates;
  const candidates = await loadCandidates(input.db);
  const report = {
    processed: 0,
    openedByReply: 0,
    openedByRead: 0,
    stayedNew: 0,
    unknown: 0,
  };

  for (const candidate of candidates) {
    report.processed += 1;

    const rebuiltProjection = await rebuildInboxProjectionForContact(
      input.persistence,
      candidate.contactId,
    );
    const nextAfterReply = decideInboxBucketFromReplyAndReadState({
      hasInThreadReply: rebuiltProjection?.bucket === "Opened",
      readState: "unknown",
    });

    if (nextAfterReply === "Opened") {
      report.openedByReply += 1;
      continue;
    }

    if (candidate.latestInboundProviderRecordId === null) {
      report.unknown += 1;
      continue;
    }

    const readState = await readStateReader({
      gmailClient: input.gmailClient,
      mailbox: input.mailbox,
      messageId: candidate.latestInboundProviderRecordId,
    });
    const nextBucket = decideInboxBucketFromReplyAndReadState({
      hasInThreadReply: false,
      readState,
    });

    if (readState === "unknown") {
      report.unknown += 1;
      continue;
    }

    if (nextBucket === "Opened") {
      await input.persistence.repositories.inboxProjection.setBucket({
        contactId: candidate.contactId,
        bucket: "Opened",
      });
      report.openedByRead += 1;
      continue;
    }

    report.stayedNew += 1;
  }

  return report;
}
