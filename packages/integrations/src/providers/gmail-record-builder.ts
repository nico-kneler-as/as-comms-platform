import { createHash } from "node:crypto";

import {
  gmailMessageRecordSchema,
  type GmailRecord
} from "./gmail.js";

export interface GmailProviderCloseMessageInput {
  readonly recordId: string;
  readonly threadId: string | null;
  readonly snippet: string;
  readonly internalDate: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly payloadRef: string;
  readonly checksum: string;
  readonly capturedMailbox: string;
  readonly receivedAt: string;
  readonly internalAddresses: readonly string[];
  readonly projectInboxAliases: readonly string[];
  readonly projectInboxAliasOverride?: string | null;
  readonly treatCapturedMailboxAsProjectInbox?: boolean;
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 ? null : normalized;
}

function uniqueEmails(values: readonly string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeEmail(value))
        .filter((value): value is string => value !== null)
    )
  ).sort((left, right) => left.localeCompare(right));
}

export function parseHeaderEmailList(value: string | undefined): string[] {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  return uniqueEmails(
    Array.from(
      value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu),
      (match) => match[0]
    )
  );
}

function resolveProjectInboxAlias(input: {
  readonly capturedMailbox: string;
  readonly fromEmails: readonly string[];
  readonly toEmails: readonly string[];
  readonly ccEmails: readonly string[];
  readonly bccEmails: readonly string[];
  readonly projectInboxAliases: readonly string[];
  readonly projectInboxAliasOverride: string | null;
  readonly treatCapturedMailboxAsProjectInbox: boolean;
}): string | null {
  if (input.projectInboxAliasOverride !== null) {
    return input.projectInboxAliasOverride;
  }

  const aliasSet = new Set(
    uniqueEmails(input.projectInboxAliases).map((alias) => alias.toLowerCase())
  );
  const candidateAddresses = [
    ...input.fromEmails,
    ...input.toEmails,
    ...input.ccEmails,
    ...input.bccEmails
  ];

  for (const address of candidateAddresses) {
    if (aliasSet.has(address.toLowerCase())) {
      return address;
    }
  }

  if (aliasSet.has(input.capturedMailbox.toLowerCase())) {
    return input.capturedMailbox;
  }

  return input.treatCapturedMailboxAsProjectInbox
    ? input.capturedMailbox
    : null;
}

export function toSafeIsoTimestamp(value: string | number | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  try {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  } catch {
    return null;
  }
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildGmailMessageRecord(
  input: GmailProviderCloseMessageInput
): GmailRecord {
  const fromEmails = parseHeaderEmailList(input.headers.From);
  const toEmails = parseHeaderEmailList(input.headers.To);
  const ccEmails = parseHeaderEmailList(input.headers.Cc);
  const bccEmails = parseHeaderEmailList(input.headers.Bcc);
  const internalAddresses = new Set(
    uniqueEmails(input.internalAddresses).map((value) => value.toLowerCase())
  );
  const projectInboxAlias = resolveProjectInboxAlias({
    capturedMailbox: input.capturedMailbox,
    fromEmails,
    toEmails,
    ccEmails,
    bccEmails,
    projectInboxAliases: input.projectInboxAliases,
    projectInboxAliasOverride:
      normalizeEmail(input.projectInboxAliasOverride ?? null),
    treatCapturedMailboxAsProjectInbox:
      input.treatCapturedMailboxAsProjectInbox ?? false
  });
  const externalParticipantEmails = uniqueEmails(
    [...fromEmails, ...toEmails, ...ccEmails, ...bccEmails].filter(
      (email) => !internalAddresses.has(email.toLowerCase())
    )
  );

  if (externalParticipantEmails.length === 0) {
    return {
      recordType: "internal_only_message",
      recordId: input.recordId
    };
  }

  const direction = fromEmails.some((email) => internalAddresses.has(email.toLowerCase()))
    ? "outbound"
    : "inbound";
  const rfc822MessageId = input.headers["Message-ID"]?.trim() ?? null;
  const occurredAt =
    toSafeIsoTimestamp(input.headers.Date) ??
    toSafeIsoTimestamp(input.internalDate ?? undefined) ??
    input.receivedAt;

  return gmailMessageRecordSchema.parse({
    recordType: "message",
    recordId: input.recordId,
    direction,
    occurredAt,
    receivedAt: input.receivedAt,
    payloadRef: input.payloadRef,
    checksum: input.checksum,
    snippet: input.snippet,
    threadId: input.threadId,
    rfc822MessageId,
    capturedMailbox: input.capturedMailbox,
    projectInboxAlias,
    normalizedParticipantEmails: externalParticipantEmails,
    salesforceContactId: null,
    volunteerIdPlainValues: [],
    normalizedPhones: [],
    supportingRecords: [],
    crossProviderCollapseKey:
      rfc822MessageId === null ? null : `rfc822:${rfc822MessageId.toLowerCase()}`
  });
}
