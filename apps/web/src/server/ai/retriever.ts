import type { Stage1RepositoryBundle } from "@as-comms/domain";

import type {
  AiDraftGrounding,
  AiDraftRequest,
  AiThreadContextEvent,
  GroundingBundle,
} from "./types";

type AiRetrieverRepositories = Pick<
  Stage1RepositoryBundle,
  | "aiKnowledge"
  | "projectKnowledge"
  | "canonicalEvents"
  | "contacts"
  | "gmailMessageDetails"
  | "salesforceCommunicationDetails"
  | "simpleTextingMessageDetails"
>;

const ISSUE_TYPE_HINTS: readonly {
  readonly issueType: string;
  readonly keywords: readonly string[];
}[] = [
  {
    issueType: "Getting started",
    keywords: ["getting started", "start", "apply", "application", "new"],
  },
  {
    issueType: "Training",
    keywords: ["training", "train", "course", "onboarding", "checklist"],
  },
  {
    issueType: "Trip planning",
    keywords: ["trip", "travel", "field", "packing", "logistics"],
  },
  {
    issueType: "Data collection",
    keywords: ["data", "protocol", "survey", "sample", "collection"],
  },
  {
    issueType: "Scheduling",
    keywords: ["schedule", "availability", "date", "time", "calendar"],
  },
];

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "because",
  "before",
  "could",
  "email",
  "hello",
  "please",
  "thanks",
  "there",
  "their",
  "would",
]);

function isCommunicationEvent(eventType: string): boolean {
  return (
    eventType === "communication.email.inbound" ||
    eventType === "communication.email.outbound" ||
    eventType === "communication.sms.inbound" ||
    eventType === "communication.sms.outbound"
  );
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function deriveIssueTypeHint(input: AiThreadContextEvent | null): string | null {
  if (input === null) {
    return null;
  }

  const haystack = `${input.subject ?? ""} ${input.body}`.toLowerCase();
  for (const hint of ISSUE_TYPE_HINTS) {
    if (hint.keywords.some((keyword) => haystack.includes(keyword))) {
      return hint.issueType;
    }
  }

  return null;
}

function deriveKeywordsLower(input: AiThreadContextEvent | null): readonly string[] {
  if (input === null) {
    return [];
  }

  const candidates = `${input.subject ?? ""} ${input.body}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/giu, " ")
    .split(/\s+/u)
    .filter((token) => token.length > 4 && !STOP_WORDS.has(token));

  return Array.from(new Set(candidates)).slice(0, 12);
}

function buildTierFourGrounding(
  event: AiThreadContextEvent,
  index: number,
): AiDraftGrounding {
  return {
    tier: 4,
    sourceProvider: event.channel === "email" ? "gmail" : "simpletexting",
    sourceId: event.canonicalEventId,
    sourceUrl: null,
    title:
      index === 0
        ? event.subject ?? event.summary
        : `Recent ${event.direction} ${event.channel}`,
  };
}

export async function retrieveGrounding(
  repositories: AiRetrieverRepositories,
  input: Pick<AiDraftRequest, "contactId" | "projectId" | "threadCursor">,
  logger: Pick<Console, "warn"> = console,
): Promise<GroundingBundle> {
  const [contact, generalTraining, projectContext, canonicalEvents] =
    await Promise.all([
      repositories.contacts.findById(input.contactId),
      repositories.aiKnowledge.findByScope({
        scope: "global",
        scopeKey: null,
      }),
      input.projectId === null
        ? Promise.resolve(null)
        : repositories.aiKnowledge.findByScope({
            scope: "project",
            scopeKey: input.projectId,
          }),
      repositories.canonicalEvents.listByContactId(input.contactId),
    ]);

  if (generalTraining === null) {
    logger.warn(
      `AI grounding is missing the global training entry for contact ${input.contactId}.`,
    );
  }

  const communicationEvents = canonicalEvents.filter((event) =>
    isCommunicationEvent(event.eventType),
  );
  const sourceEvidenceIds = communicationEvents.map((event) => event.sourceEvidenceId);
  const [gmailDetails, salesforceDetails, simpleTextingDetails] =
    await Promise.all([
      repositories.gmailMessageDetails.listBySourceEvidenceIds(sourceEvidenceIds),
      repositories.salesforceCommunicationDetails.listBySourceEvidenceIds(
        sourceEvidenceIds,
      ),
      repositories.simpleTextingMessageDetails.listBySourceEvidenceIds(
        sourceEvidenceIds,
      ),
    ]);

  const gmailDetailBySourceEvidenceId = new Map(
    gmailDetails.map((detail) => [detail.sourceEvidenceId, detail]),
  );
  const salesforceDetailBySourceEvidenceId = new Map(
    salesforceDetails.map((detail) => [detail.sourceEvidenceId, detail]),
  );
  const simpleTextingDetailBySourceEvidenceId = new Map(
    simpleTextingDetails.map((detail) => [detail.sourceEvidenceId, detail]),
  );

  const threadEvents: AiThreadContextEvent[] = communicationEvents.flatMap(
    (event): AiThreadContextEvent[] => {
      const direction = event.eventType.endsWith(".inbound")
        ? "inbound"
        : "outbound";

      if (event.channel === "email") {
        const gmailDetail = gmailDetailBySourceEvidenceId.get(event.sourceEvidenceId);
        const salesforceDetail = salesforceDetailBySourceEvidenceId.get(
          event.sourceEvidenceId,
        );
        const body =
          gmailDetail?.bodyTextPreview ??
          gmailDetail?.snippetClean ??
          salesforceDetail?.snippet ??
          "";

        return [
          {
            canonicalEventId: event.id,
            occurredAt: event.occurredAt,
            direction,
            channel: "email",
            subject: gmailDetail?.subject ?? salesforceDetail?.subject ?? null,
            summary:
              gmailDetail?.subject ??
              salesforceDetail?.subject ??
              (direction === "inbound" ? "Inbound email" : "Outbound email"),
            body,
            threadId: gmailDetail?.gmailThreadId ?? null,
          },
        ];
      }

      const simpleTextingDetail = simpleTextingDetailBySourceEvidenceId.get(
        event.sourceEvidenceId,
      );
      const salesforceDetail = salesforceDetailBySourceEvidenceId.get(
        event.sourceEvidenceId,
      );

      return [
        {
          canonicalEventId: event.id,
          occurredAt: event.occurredAt,
          direction,
          channel: "sms",
          subject: null,
          summary:
            salesforceDetail?.sourceLabel ??
            (direction === "inbound" ? "Inbound text" : "Outbound text"),
          body:
            simpleTextingDetail?.messageTextPreview ??
            salesforceDetail?.snippet ??
            "",
          threadId: simpleTextingDetail?.threadKey ?? null,
        },
      ];
    },
  );

  const inboundEvents = threadEvents.filter((event) => event.direction === "inbound");
  const targetInbound =
    (input.threadCursor === null
      ? null
      : inboundEvents.find(
          (event) => event.canonicalEventId === input.threadCursor,
        )) ??
    inboundEvents.at(-1) ??
    null;

  const recentEvents =
    targetInbound === null
      ? []
      : threadEvents
          .filter(
            (event) =>
              event.canonicalEventId !== targetInbound.canonicalEventId &&
              event.occurredAt <= targetInbound.occurredAt,
          )
          .slice(-10)
          .map((event) => ({
            ...event,
            body: truncate(event.body, 500),
          }));

  const tier3Entries =
    input.projectId === null || targetInbound === null
      ? []
      : await repositories.projectKnowledge.getForRetrieval({
          projectId: input.projectId,
          issueTypeHint: deriveIssueTypeHint(targetInbound),
          keywordsLower: deriveKeywordsLower(targetInbound),
          limitPerKind: 3,
        });

  const grounding: AiDraftGrounding[] = [];

  if (generalTraining !== null) {
    grounding.push({
      tier: 1,
      sourceProvider: generalTraining.sourceProvider,
      sourceId: generalTraining.sourceId,
      sourceUrl: generalTraining.sourceUrl,
      title: generalTraining.title,
    });
  }

  if (projectContext !== null) {
    grounding.push({
      tier: 2,
      sourceProvider: projectContext.sourceProvider,
      sourceId: projectContext.sourceId,
      sourceUrl: projectContext.sourceUrl,
      title: projectContext.title,
    });
  }

  grounding.push(
    ...tier3Entries.map((entry): AiDraftGrounding => ({
      tier: 3,
      sourceProvider: "platform",
      sourceId: entry.id,
      sourceUrl: null,
      title: entry.questionSummary,
    })),
  );

  if (targetInbound !== null) {
    grounding.push(buildTierFourGrounding(targetInbound, 0));
    grounding.push(
      ...recentEvents.map((event, index) => buildTierFourGrounding(event, index + 1)),
    );
  }

  return {
    contact,
    generalTraining,
    projectContext,
    tier3Entries: [...tier3Entries],
    targetInbound:
      targetInbound === null
        ? null
        : {
            ...targetInbound,
            body: truncate(targetInbound.body, 2_000),
          },
    recentEvents,
    grounding,
  };
}
