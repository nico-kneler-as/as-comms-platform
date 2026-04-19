import {
  buildGmailMessageRecord,
  normalizeGmailSubject,
  sha256Text,
  toSafeIsoTimestamp,
  type GmailProviderCloseMessageInput
} from "./gmail-record-builder.js";
import {
  extractGmailBodyPreviewFromMimeMessage
} from "./gmail-body.js";
import { gmailRecordSchema, type GmailRecord } from "./gmail.js";

import { z } from "zod";

const emailSchema = z.string().email();

const gmailMboxImportSchema = z.object({
  mboxText: z.string().min(1),
  mboxPath: z.string().min(1),
  capturedMailbox: emailSchema,
  liveAccount: emailSchema,
  projectInboxAliases: z.array(emailSchema).default([]),
  projectInboxAliasOverride: emailSchema.nullable().default(null),
  receivedAt: z.string().datetime(),
  limit: z.number().int().positive().nullable().default(null)
});

export type GmailMboxImportInput = z.input<typeof gmailMboxImportSchema>;

interface ParsedMboxMessage {
  readonly index: number;
  readonly rawMessage: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
}

function splitMboxMessages(mboxText: string): ParsedMboxMessage[] {
  const normalized = normalizeLineEndings(mboxText);
  const lines = normalized.split("\n");
  const messages: string[] = [];
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("From ")) {
      if (currentLines.length > 0) {
        messages.push(currentLines.join("\n").trim());
        currentLines = [];
      }

      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    messages.push(currentLines.join("\n").trim());
  }

  return messages
    .filter((message) => message.length > 0)
    .map((rawMessage, index) => {
      const separatorIndex = rawMessage.indexOf("\n\n");
      const headerSection =
        separatorIndex >= 0 ? rawMessage.slice(0, separatorIndex) : rawMessage;
      const bodyText =
        separatorIndex >= 0 ? rawMessage.slice(separatorIndex + 2) : "";
      const headers = parseHeaders(headerSection);

      return {
        index,
        rawMessage,
        headers,
        bodyText
      };
    });
}

function parseHeaders(headerSection: string): Readonly<Record<string, string>> {
  const headers = new Map<string, string>();
  let currentName: string | null = null;
  let currentValue = "";

  function flushCurrentHeader(): void {
    if (currentName === null) {
      return;
    }

    headers.set(currentName, currentValue.trim());
  }

  for (const line of headerSection.split("\n")) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      currentValue = `${currentValue} ${line.trim()}`.trim();
      continue;
    }

    flushCurrentHeader();
    const separatorIndex = line.indexOf(":");

    if (separatorIndex <= 0) {
      currentName = null;
      currentValue = "";
      continue;
    }

    currentName = line.slice(0, separatorIndex).trim();
    currentValue = line.slice(separatorIndex + 1).trim();
  }

  flushCurrentHeader();
  return Object.fromEntries(headers.entries());
}

function buildSnippet(cleanBodyPreview: string, subject: string | undefined): string {
  if (cleanBodyPreview.length > 0) {
    return cleanBodyPreview.slice(0, 280);
  }

  return normalizeGmailSubject(subject) ?? "";
}

function buildThreadId(headers: Readonly<Record<string, string>>): string | null {
  const explicitThreadId = headers["X-GM-THRID"]?.trim() ?? null;

  if (explicitThreadId !== null && explicitThreadId.length > 0) {
    return explicitThreadId;
  }

  const references = headers.References?.trim() ?? null;

  if (references !== null && references.length > 0) {
    return references;
  }

  const inReplyTo = headers["In-Reply-To"]?.trim() ?? null;
  return inReplyTo !== null && inReplyTo.length > 0 ? inReplyTo : null;
}

function buildMboxRecordId(input: {
  readonly rawMessage: string;
  readonly capturedMailbox: string;
}): string {
  return `mbox:${sha256Text(
    `${input.capturedMailbox.toLowerCase()}\n${normalizeLineEndings(input.rawMessage)}`
  )}`;
}

export async function importGmailMboxRecords(
  input: GmailMboxImportInput
): Promise<GmailRecord[]> {
  const parsedInput = gmailMboxImportSchema.parse(input);
  const messages = splitMboxMessages(parsedInput.mboxText);
  const selectedMessages =
    parsedInput.limit === null ? messages : messages.slice(0, parsedInput.limit);

  return Promise.all(selectedMessages.map(async (message) => {
    const recordId = buildMboxRecordId({
      rawMessage: message.rawMessage,
      capturedMailbox: parsedInput.capturedMailbox
    });
    const payloadRef = `mbox://${encodeURIComponent(parsedInput.mboxPath)}#message=${String(
      message.index + 1
    )}`;
    const checksum = sha256Text(normalizeLineEndings(message.rawMessage));
    const internalDate =
      toSafeIsoTimestamp(message.headers.Date) ?? parsedInput.receivedAt;
    const bodyTextPreview = await extractGmailBodyPreviewFromMimeMessage({
      rawMessage: message.rawMessage,
      fallbackBodyText: message.bodyText
    });
    const snippetClean = buildSnippet(bodyTextPreview, message.headers.Subject);
    const recordInput: GmailProviderCloseMessageInput = {
      recordId,
      threadId: buildThreadId(message.headers),
      snippet: snippetClean,
      snippetClean,
      bodyTextPreview,
      internalDate,
      headers: message.headers,
      payloadRef,
      checksum,
      capturedMailbox: parsedInput.capturedMailbox,
      receivedAt: parsedInput.receivedAt,
      internalAddresses: [
        parsedInput.liveAccount,
        parsedInput.capturedMailbox,
        ...parsedInput.projectInboxAliases
      ],
      projectInboxAliases: parsedInput.projectInboxAliases,
      projectInboxAliasOverride: parsedInput.projectInboxAliasOverride,
      treatCapturedMailboxAsProjectInbox: true
    };

    return gmailRecordSchema.parse(buildGmailMessageRecord(recordInput));
  }));
}
