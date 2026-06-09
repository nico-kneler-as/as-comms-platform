import { createHash } from "node:crypto";

import libmime from "libmime";

import { gmailMessageRecordSchema, type GmailRecord } from "./gmail.js";
import type {
  GmailAttachmentMetadata,
  GmailDriveAttachmentMetadata
} from "./gmail-body.js";

export interface GmailProviderCloseMessageInput {
  readonly recordId: string;
  readonly threadId: string | null;
  readonly labelIds?: readonly string[] | null;
  readonly snippet: string;
  readonly snippetClean?: string;
  readonly bodyTextPreview?: string | null;
  readonly bodyKind?:
    | "plaintext"
    | "encrypted_placeholder"
    | "binary_fallback"
    | null;
  readonly dsnOriginalMessageId?: string | null;
  readonly internalDate: string | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly payloadRef: string;
  readonly checksum: string;
  readonly capturedMailbox: string;
  readonly receivedAt: string;
  readonly internalAddresses: readonly string[];
  readonly projectInboxAliases: readonly string[];
  readonly attachmentMetadata?: readonly GmailAttachmentMetadata[];
  readonly driveAttachmentMetadata?: readonly GmailDriveAttachmentMetadata[];
  readonly htmlBodyCidReferences?: readonly string[];
  readonly projectInboxAliasOverride?: string | null;
  readonly treatCapturedMailboxAsProjectInbox?: boolean;
}

const ADVENTURE_SCIENTISTS_DOMAIN = "@adventurescientists.org";

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
        .filter((value): value is string => value !== null),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function uniqueLabelIds(values: readonly string[]): string[] {
  return Array.from(
    new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeHeaderValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .replace(/\r\n?[\t ]+/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return normalized.length === 0 ? null : normalized;
}

function isInternalEmail(
  email: string,
  internalAddresses: ReadonlySet<string>,
): boolean {
  const normalized = email.toLowerCase();

  return (
    internalAddresses.has(normalized) ||
    normalized.endsWith(ADVENTURE_SCIENTISTS_DOMAIN)
  );
}

function hasEmail(values: readonly string[], value: string | null): boolean {
  if (value === null) {
    return false;
  }

  return values.some((email) => email.toLowerCase() === value.toLowerCase());
}

export function parseHeaderEmailList(value: string | undefined): string[] {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  return uniqueEmails(
    Array.from(
      value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu),
      (match) => match[0],
    ),
  );
}

function splitHeaderEntries(value: string): string[] {
  return value
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/gu)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function decodeHeaderDisplayName(value: string): string {
  try {
    return libmime.decodeWords(value).trim();
  } catch {
    return value.trim();
  }
}

function normalizeObservedDisplayName(
  value: string,
  email: string,
): string | null {
  const trimmed = value.trim().replace(/^"(.*)"$/u, "$1").trim();

  if (trimmed.length === 0) {
    return null;
  }

  const decoded = decodeHeaderDisplayName(trimmed);

  if (decoded.length === 0) {
    return null;
  }

  const normalizedDisplayName = decoded.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedLocalPart = normalizedEmail.split("@", 1)[0] ?? normalizedEmail;

  if (
    normalizedDisplayName === normalizedEmail ||
    normalizedDisplayName === normalizedLocalPart
  ) {
    return null;
  }

  return decoded;
}

function parseHeaderEntry(value: string): { email: string | null; displayName: string | null } {
  const bracketMatch = /^(.*?)(?:<([^>]+)>)$/u.exec(value);

  if (bracketMatch !== null) {
    const [, rawDisplayName = "", rawEmail = ""] = bracketMatch;
    return {
      email: normalizeEmail(rawEmail),
      displayName: rawDisplayName.trim().length > 0 ? rawDisplayName.trim() : null,
    };
  }

  const emailMatch = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.exec(value);

  if (emailMatch === null) {
    return {
      email: null,
      displayName: null,
    };
  }

  const rawEmail = emailMatch[0];
  const displayName = value.replace(rawEmail, "").trim();

  return {
    email: normalizeEmail(rawEmail),
    displayName: displayName.length > 0 ? displayName : null,
  };
}

/**
 * Extract the display name portion of an RFC-822 header entry that matches
 * `targetEmail`.
 */
export function parseHeaderDisplayNameForEmail(
  header: string | null | undefined,
  targetEmail: string,
): string | null {
  const normalizedTargetEmail = normalizeEmail(targetEmail);

  if (
    typeof header !== "string" ||
    header.trim().length === 0 ||
    normalizedTargetEmail === null
  ) {
    return null;
  }

  for (const entry of splitHeaderEntries(header)) {
    const parsed = parseHeaderEntry(entry);

    if (parsed.email !== normalizedTargetEmail) {
      continue;
    }

    if (parsed.displayName === null) {
      return null;
    }

    return normalizeObservedDisplayName(parsed.displayName, normalizedTargetEmail);
  }

  return null;
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
    uniqueEmails(input.projectInboxAliases).map((alias) => alias.toLowerCase()),
  );
  const candidateAddresses = [
    ...input.fromEmails,
    ...input.toEmails,
    ...input.ccEmails,
    ...input.bccEmails,
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

export function toSafeIsoTimestamp(
  value: string | number | undefined,
): string | null {
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

export function normalizeGmailSubject(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  try {
    const decoded = libmime.decodeWords(trimmed).trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return trimmed;
  }
}

export function buildGmailMessageRecord(
  input: GmailProviderCloseMessageInput,
): GmailRecord {
  const fromHeader = normalizeHeaderValue(input.headers.From);
  const toHeader = normalizeHeaderValue(input.headers.To);
  const ccHeader = normalizeHeaderValue(input.headers.Cc);
  const fromEmails = parseHeaderEmailList(input.headers.From);
  const toEmails = parseHeaderEmailList(input.headers.To);
  const ccEmails = parseHeaderEmailList(input.headers.Cc);
  const bccEmails = parseHeaderEmailList(input.headers.Bcc);
  const internalAddresses = new Set(
    uniqueEmails(input.internalAddresses).map((value) => value.toLowerCase()),
  );
  const projectInboxAlias = resolveProjectInboxAlias({
    capturedMailbox: input.capturedMailbox,
    fromEmails,
    toEmails,
    ccEmails,
    bccEmails,
    projectInboxAliases: input.projectInboxAliases,
    projectInboxAliasOverride: normalizeEmail(
      input.projectInboxAliasOverride ?? null,
    ),
    treatCapturedMailboxAsProjectInbox:
      input.treatCapturedMailboxAsProjectInbox ?? false,
  });
  const externalParticipantEmails = uniqueEmails(
    [...fromEmails, ...toEmails, ...ccEmails, ...bccEmails].filter(
      (email) => !isInternalEmail(email, internalAddresses),
    ),
  );
  const mailboxAddresses = new Set(
    uniqueEmails([
      input.capturedMailbox,
      ...input.projectInboxAliases,
      ...input.internalAddresses,
    ]).map((email) => email.toLowerCase()),
  );
  const senderIsInternal = fromEmails.some((email) =>
    isInternalEmail(email, internalAddresses),
  );
  const senderIsMailbox = fromEmails.some((email) =>
    mailboxAddresses.has(email.toLowerCase()),
  );
  const internalSenderEmails = uniqueEmails(
    fromEmails.filter((email) => isInternalEmail(email, internalAddresses)),
  );
  const staffSenderEmails = internalSenderEmails.filter(
    (email) => !mailboxAddresses.has(email.toLowerCase()),
  );
  const externalSenderEmails = uniqueEmails(
    fromEmails.filter((email) => !isInternalEmail(email, internalAddresses)),
  );
  const externalPrimaryRecipientEmails = uniqueEmails(
    toEmails.filter((email) => !isInternalEmail(email, internalAddresses)),
  );
  const externalCopiedRecipientEmails = uniqueEmails(
    [...ccEmails, ...bccEmails].filter(
      (email) => !isInternalEmail(email, internalAddresses),
    ),
  );
  const externalRecipientEmails =
    externalPrimaryRecipientEmails.length > 0
      ? externalPrimaryRecipientEmails
      : externalCopiedRecipientEmails;
  const internalRecipientEmails = uniqueEmails(
    [...toEmails, ...ccEmails, ...bccEmails].filter(
      (email) =>
        isInternalEmail(email, internalAddresses) &&
        !mailboxAddresses.has(email.toLowerCase()),
    ),
  );
  const identityParticipantEmails =
    senderIsInternal && externalRecipientEmails.length > 0
      ? externalRecipientEmails
      : externalSenderEmails.length > 0
        ? externalSenderEmails
        : senderIsMailbox && internalRecipientEmails.length > 0
          ? internalRecipientEmails
        : externalParticipantEmails;
  const projectInboxCopyRecipient =
    projectInboxAlias !== null &&
    !hasEmail(fromEmails, projectInboxAlias) &&
    (hasEmail(toEmails, projectInboxAlias) ||
      hasEmail(ccEmails, projectInboxAlias) ||
      hasEmail(bccEmails, projectInboxAlias));
  const capturedMailboxRecipient =
    !hasEmail(fromEmails, input.capturedMailbox) &&
    (hasEmail(toEmails, input.capturedMailbox) ||
      hasEmail(ccEmails, input.capturedMailbox) ||
      hasEmail(bccEmails, input.capturedMailbox) ||
      // Gmail only exposes the current mailbox as capture context when a
      // monitored address was Bcc'd or reached through a routing rule.
      input.capturedMailbox.trim().length > 0);
  const staffOriginatedMailboxMessage =
    senderIsInternal &&
    staffSenderEmails.length > 0 &&
    !senderIsMailbox &&
    (projectInboxCopyRecipient || capturedMailboxRecipient);

  if (
    externalParticipantEmails.length === 0 &&
    !staffOriginatedMailboxMessage &&
    !senderIsMailbox
  ) {
    return {
      recordType: "internal_only_message",
      recordId: input.recordId,
    };
  }

  const direction =
    staffOriginatedMailboxMessage ||
    (projectInboxCopyRecipient && !senderIsMailbox)
      ? "inbound"
      : senderIsInternal
        ? "outbound"
        : "inbound";
  const normalizedParticipantEmails =
    staffOriginatedMailboxMessage && identityParticipantEmails.length === 0
      ? staffSenderEmails
      : identityParticipantEmails;
  const labelIds =
    input.labelIds === undefined || input.labelIds === null
      ? null
      : uniqueLabelIds(input.labelIds);
  const rfc822MessageId = input.headers["Message-ID"]?.trim() ?? null;
  const subject = normalizeGmailSubject(input.headers.Subject);
  const occurredAt =
    toSafeIsoTimestamp(input.headers.Date) ??
    toSafeIsoTimestamp(input.internalDate ?? undefined) ??
    input.receivedAt;
  const snippetClean = input.snippetClean?.trim() ?? input.snippet.trim();
  const bodyTextPreview =
    input.bodyTextPreview?.trim() ??
    (snippetClean.length > 0 ? snippetClean : input.snippet.trim());

  return gmailMessageRecordSchema.parse({
    recordType: "message",
    recordId: input.recordId,
    direction,
    occurredAt,
    receivedAt: input.receivedAt,
    payloadRef: input.payloadRef,
    checksum: input.checksum,
    snippet: input.snippet,
    subject,
    fromHeader,
    toHeader,
    ccHeader,
    labelIds,
    snippetClean,
    bodyTextPreview,
    bodyKind: input.bodyKind ?? "plaintext",
    dsnOriginalMessageId: input.dsnOriginalMessageId ?? null,
    threadId: input.threadId,
    rfc822MessageId,
    capturedMailbox: input.capturedMailbox,
    projectInboxAlias,
    normalizedParticipantEmails,
    fromEmails,
    toEmails,
    ccEmails,
    bccEmails,
    salesforceContactId: null,
    volunteerIdPlainValues: [],
    normalizedPhones: [],
    supportingRecords: [],
    crossProviderCollapseKey:
      rfc822MessageId === null
        ? null
        : `rfc822:${rfc822MessageId.toLowerCase()}`,
    attachmentMetadata: input.attachmentMetadata ?? [],
    driveAttachmentMetadata: input.driveAttachmentMetadata ?? [],
    htmlBodyCidReferences: input.htmlBodyCidReferences ?? [],
  });
}
