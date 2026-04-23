export interface SalesforceTaskAuditRow {
  readonly canonicalEventId: string;
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly payloadRef: string;
  readonly contactId: string;
  readonly displayName: string;
  readonly salesforceContactId: string | null;
  readonly membershipCount: number;
  readonly projects: string | null;
  readonly messageKind: "auto" | "one_to_one" | "campaign";
  readonly subject: string | null;
  readonly snippet: string;
  readonly sourceLabel: string;
  readonly occurredAt: string;
  readonly subjectEventCount: number;
  readonly subjectContactCount: number;
}

export interface SalesforceTaskAuditSignals {
  readonly subjectPrefix: "reply" | "forward" | "none";
  readonly hasStructuredEnvelope: boolean;
  readonly hasQuotedReply: boolean;
  readonly hasHtmlMarkup: boolean;
  readonly hasVolunteerAutomationKeyword: boolean;
  readonly hasBatchLikeSubject: boolean;
  readonly hasConversationSignal: boolean;
  readonly hasAutomationSignal: boolean;
}

export type SalesforceTaskInferredShape =
  | "probable_human_conversation"
  | "probable_automation"
  | "mixed"
  | "unclear";

export interface SalesforceTaskAuditAnnotatedRow extends SalesforceTaskAuditRow {
  readonly signals: SalesforceTaskAuditSignals;
  readonly inferredShape: SalesforceTaskInferredShape;
}

export interface SalesforceTaskAuditTopSubject {
  readonly subject: string;
  readonly eventCount: number;
  readonly contactCount: number;
}

export interface SalesforceTaskAuditReport {
  readonly totalRows: number;
  readonly distinctContacts: number;
  readonly rowsWithoutMembership: number;
  readonly messageKindCounts: Readonly<Record<string, number>>;
  readonly inferredShapeCounts: Readonly<Record<string, number>>;
  readonly signalCounts: Readonly<Record<string, number>>;
  readonly mismatchCounts: Readonly<Record<string, number>>;
  readonly topSubjects: readonly SalesforceTaskAuditTopSubject[];
  readonly samples: {
    readonly autoWithConversationSignal: readonly SalesforceTaskAuditAnnotatedRow[];
    readonly autoButProbablyHuman: readonly SalesforceTaskAuditAnnotatedRow[];
    readonly oneToOneButProbablyAutomation: readonly SalesforceTaskAuditAnnotatedRow[];
    readonly probableHumanConversation: readonly SalesforceTaskAuditAnnotatedRow[];
    readonly probableAutomation: readonly SalesforceTaskAuditAnnotatedRow[];
  };
}

const replyPrefixPattern = /^\s*re\s*:/iu;
const forwardPrefixPattern = /^\s*(?:fw|fwd)\s*:/iu;
const structuredEnvelopePatterns = [
  /^from:/imu,
  /^recipients?:/imu,
  /^subject:/imu,
  /^body:/imu
] as const;
const quotedReplyPatterns = [
  /\bon .+ wrote:/iu,
  /forwarded message/iu,
  /original message/iu
] as const;
const volunteerAutomationKeywordPatterns = [
  /\btraining\b/iu,
  /\bapplication\b/iu,
  /\bapply(?:ing|)?\b/iu,
  /\bcapacit/iu,
  /\bnext step\b/iu,
  /\bwaitlist\b/iu,
  /\breminder\b/iu,
  /\bvolunteer gathering\b/iu,
  /\bpints for pines\b/iu,
  /\bstart your training\b/iu,
  /\bcomplete(?:d)? your training\b/iu,
  /\byour [a-z0-9' -]+ application\b/iu,
  /\bready\. set\. go\./iu
] as const;

function matchesAnyPattern(
  value: string | null | undefined,
  patterns: readonly RegExp[]
): boolean {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  return patterns.some((pattern) => pattern.test(value));
}

function normalizeSubject(value: string | null): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "(no subject)";
}

function buildSubjectStats(
  rows: readonly SalesforceTaskAuditRow[]
): readonly SalesforceTaskAuditTopSubject[] {
  const stats = new Map<
    string,
    {
      eventCount: number;
      contactIds: Set<string>;
    }
  >();

  for (const row of rows) {
    const subject = normalizeSubject(row.subject);
    const current = stats.get(subject) ?? {
      eventCount: 0,
      contactIds: new Set<string>()
    };
    current.eventCount += 1;
    current.contactIds.add(row.contactId);
    stats.set(subject, current);
  }

  return Array.from(stats.entries())
    .map(([subject, value]) => ({
      subject,
      eventCount: value.eventCount,
      contactCount: value.contactIds.size
    }))
    .sort((left, right) => {
      if (left.eventCount !== right.eventCount) {
        return right.eventCount - left.eventCount;
      }

      return left.subject.localeCompare(right.subject);
    });
}

export function deriveSalesforceTaskAuditSignals(
  row: Pick<
    SalesforceTaskAuditRow,
    "subject" | "snippet" | "subjectContactCount"
  >
): SalesforceTaskAuditSignals {
  const subject = row.subject?.trim() ?? null;
  const snippet = row.snippet;
  const subjectPrefix = replyPrefixPattern.test(subject ?? "")
    ? "reply"
    : forwardPrefixPattern.test(subject ?? "")
      ? "forward"
      : "none";
  const hasStructuredEnvelope =
    structuredEnvelopePatterns.every((pattern) => pattern.test(snippet));
  const hasQuotedReply = matchesAnyPattern(snippet, quotedReplyPatterns);
  const hasHtmlMarkup = /<\/?[a-z][^>]*>/iu.test(snippet);
  const hasVolunteerAutomationKeyword =
    matchesAnyPattern(subject, volunteerAutomationKeywordPatterns) ||
    matchesAnyPattern(snippet, volunteerAutomationKeywordPatterns);
  const hasBatchLikeSubject = row.subjectContactCount >= 5;
  const hasConversationSignal =
    subjectPrefix !== "none" || hasStructuredEnvelope || hasQuotedReply;
  const hasAutomationSignal =
    hasVolunteerAutomationKeyword || hasBatchLikeSubject || hasHtmlMarkup;

  return {
    subjectPrefix,
    hasStructuredEnvelope,
    hasQuotedReply,
    hasHtmlMarkup,
    hasVolunteerAutomationKeyword,
    hasBatchLikeSubject,
    hasConversationSignal,
    hasAutomationSignal
  };
}

export function inferSalesforceTaskShape(
  signals: SalesforceTaskAuditSignals
): SalesforceTaskInferredShape {
  if (signals.hasConversationSignal && !signals.hasAutomationSignal) {
    return "probable_human_conversation";
  }

  if (!signals.hasConversationSignal && signals.hasAutomationSignal) {
    return "probable_automation";
  }

  if (signals.hasConversationSignal && signals.hasAutomationSignal) {
    return "mixed";
  }

  return "unclear";
}

export function annotateSalesforceTaskAuditRows(
  rows: readonly SalesforceTaskAuditRow[]
): readonly SalesforceTaskAuditAnnotatedRow[] {
  return rows.map((row) => {
    const signals = deriveSalesforceTaskAuditSignals(row);

    return {
      ...row,
      signals,
      inferredShape: inferSalesforceTaskShape(signals)
    };
  });
}

function incrementCounter(
  counters: Map<string, number>,
  key: string
): void {
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

function toRecord(counters: Map<string, number>): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Array.from(counters.entries()).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

function buildVariedSample(
  rows: readonly SalesforceTaskAuditAnnotatedRow[],
  limit: number
): readonly SalesforceTaskAuditAnnotatedRow[] {
  const sample: SalesforceTaskAuditAnnotatedRow[] = [];
  const seenSubjects = new Set<string>();

  for (const row of rows) {
    const subjectKey = normalizeSubject(row.subject);
    if (seenSubjects.has(subjectKey)) {
      continue;
    }

    sample.push(row);
    seenSubjects.add(subjectKey);
    if (sample.length >= limit) {
      return sample;
    }
  }

  for (const row of rows) {
    if (sample.length >= limit) {
      break;
    }

    if (sample.some((existing) => existing.providerRecordId === row.providerRecordId)) {
      continue;
    }

    sample.push(row);
  }

  return sample;
}

export function buildSalesforceTaskAuditReport(
  rows: readonly SalesforceTaskAuditRow[],
  input?: {
    readonly sampleLimit?: number;
    readonly topSubjectLimit?: number;
  }
): SalesforceTaskAuditReport {
  const sampleLimit = input?.sampleLimit ?? 8;
  const topSubjectLimit = input?.topSubjectLimit ?? 20;
  const annotatedRows = annotateSalesforceTaskAuditRows(rows);
  const distinctContacts = new Set(rows.map((row) => row.contactId)).size;
  const messageKindCounts = new Map<string, number>();
  const inferredShapeCounts = new Map<string, number>();
  const signalCounts = new Map<string, number>();
  const mismatchCounts = new Map<string, number>();

  for (const row of annotatedRows) {
    incrementCounter(messageKindCounts, row.messageKind);
    incrementCounter(inferredShapeCounts, row.inferredShape);
    if (row.signals.hasConversationSignal) {
      incrementCounter(signalCounts, "conversation_signal");
    }
    if (row.signals.hasAutomationSignal) {
      incrementCounter(signalCounts, "automation_signal");
    }
    if (row.messageKind === "auto" && row.signals.hasConversationSignal) {
      incrementCounter(mismatchCounts, "auto_with_conversation_signal");
    }
    if (row.messageKind === "one_to_one" && row.signals.hasAutomationSignal) {
      incrementCounter(mismatchCounts, "one_to_one_with_automation_signal");
    }

    if (
      row.messageKind === "auto" &&
      row.inferredShape === "probable_human_conversation"
    ) {
      incrementCounter(mismatchCounts, "auto_but_probably_human");
    }

    if (
      row.messageKind === "one_to_one" &&
      row.inferredShape === "probable_automation"
    ) {
      incrementCounter(mismatchCounts, "one_to_one_but_probably_automation");
    }
  }

  const probableHumanConversation = annotatedRows.filter(
    (row) => row.inferredShape === "probable_human_conversation"
  );
  const probableAutomation = annotatedRows.filter(
    (row) => row.inferredShape === "probable_automation"
  );
  const autoWithConversationSignal = annotatedRows.filter(
    (row) => row.messageKind === "auto" && row.signals.hasConversationSignal
  );
  const autoButProbablyHuman = probableHumanConversation.filter(
    (row) => row.messageKind === "auto"
  );
  const oneToOneButProbablyAutomation = probableAutomation.filter(
    (row) => row.messageKind === "one_to_one"
  );

  return {
    totalRows: rows.length,
    distinctContacts,
    rowsWithoutMembership: rows.filter((row) => row.membershipCount === 0).length,
    messageKindCounts: toRecord(messageKindCounts),
    inferredShapeCounts: toRecord(inferredShapeCounts),
    signalCounts: toRecord(signalCounts),
    mismatchCounts: toRecord(mismatchCounts),
    topSubjects: buildSubjectStats(rows).slice(0, topSubjectLimit),
    samples: {
      autoWithConversationSignal: buildVariedSample(
        autoWithConversationSignal,
        sampleLimit
      ),
      autoButProbablyHuman: buildVariedSample(
        autoButProbablyHuman,
        sampleLimit
      ),
      oneToOneButProbablyAutomation: buildVariedSample(
        oneToOneButProbablyAutomation,
        sampleLimit
      ),
      probableHumanConversation: buildVariedSample(
        probableHumanConversation,
        sampleLimit
      ),
      probableAutomation: buildVariedSample(probableAutomation, sampleLimit)
    }
  };
}

export function formatSnippetPreview(
  snippet: string,
  maxLength = 240
): string {
  const normalized = snippet.replaceAll(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
