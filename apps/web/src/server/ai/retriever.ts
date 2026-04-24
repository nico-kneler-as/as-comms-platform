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
  | "canonicalEvents"
  | "contacts"
  | "gmailMessageDetails"
  | "salesforceCommunicationDetails"
  | "simpleTextingMessageDetails"
>;

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

