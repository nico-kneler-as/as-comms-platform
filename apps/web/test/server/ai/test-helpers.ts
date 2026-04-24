import type {
  AiKnowledgeEntryRecord,
  ProjectKnowledgeEntryRecord,
} from "@as-comms/contracts";

import type { Stage1WebTestRuntime } from "../../../src/server/stage1-runtime.test-support";
import {
  seedInboxContact,
  seedInboxEmailEvent,
} from "../../../tests/unit/inbox-stage1-helpers";

const NOW_ISO = "2026-04-24T12:00:00.000Z";

export async function seedAiContact(
  runtime: Stage1WebTestRuntime,
  input?: {
    readonly contactId?: string;
    readonly projectId?: string;
    readonly projectName?: string;
  },
): Promise<void> {
  await seedInboxContact(runtime.context, {
    contactId: input?.contactId ?? "contact:maya",
    salesforceContactId: "sf-contact:maya",
    displayName: "Maya Chen",
    primaryEmail: "maya@example.org",
    primaryPhone: null,
    projectId: input?.projectId ?? "project:whitebark",
    projectName: input?.projectName ?? "Whitebark Pines",
    membershipId: "membership:maya:whitebark",
    membershipStatus: "active",
  });
}

export async function seedAiThread(
  runtime: Stage1WebTestRuntime,
  input?: {
    readonly contactId?: string;
  },
): Promise<{
  readonly latestInboundId: string;
}> {
  const contactId = input?.contactId ?? "contact:maya";
  await seedInboxEmailEvent(runtime.context, {
    id: "thread-1-outbound",
    contactId,
    occurredAt: "2026-04-23T08:00:00.000Z",
    direction: "outbound",
    subject: "Re: Whitebark kit",
    snippet: "Happy to help with the kit list.",
    bodyTextPreview: "Happy to help with the kit list.",
  });
  const inbound = await seedInboxEmailEvent(runtime.context, {
    id: "thread-1-inbound",
    contactId,
    occurredAt: "2026-04-24T09:15:00.000Z",
    direction: "inbound",
    subject: "Whitebark kit",
    snippet: "Can you send the current field kit list?",
    bodyTextPreview: "Can you send the current field kit list?",
  });

  return {
    latestInboundId: inbound.canonicalEventId,
  };
}

export async function seedAiKnowledge(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly scope: "global" | "project";
    readonly scopeKey: string | null;
    readonly id: string;
    readonly title: string;
    readonly content: string;
  },
): Promise<AiKnowledgeEntryRecord> {
  return runtime.context.repositories.aiKnowledge.upsert({
    id: input.id,
    scope: input.scope,
    scopeKey: input.scopeKey,
    sourceProvider: "notion",
    sourceId: input.id.replaceAll(":", "-"),
    sourceUrl: `https://www.notion.so/${input.id.replaceAll(":", "-")}`,
    title: input.title,
    content: input.content,
    contentHash: `hash:${input.id}`,
    metadataJson: {},
    sourceLastEditedAt: NOW_ISO,
    syncedAt: NOW_ISO,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  });
}

export async function seedProjectKnowledge(
  runtime: Stage1WebTestRuntime,
  input?: {
    readonly id?: string;
    readonly projectId?: string;
    readonly kind?: "canonical_reply" | "snippet" | "pattern";
    readonly questionSummary?: string;
    readonly issueType?: string | null;
    readonly approvedForAi?: boolean;
  },
): Promise<ProjectKnowledgeEntryRecord> {
  return runtime.context.repositories.projectKnowledge.upsert({
    id: input?.id ?? "knowledge:whitebark:field-kit",
    projectId: input?.projectId ?? "project:whitebark",
    kind: input?.kind ?? "canonical_reply",
    issueType: input?.issueType ?? "Trip planning",
    volunteerStage: null,
    questionSummary: input?.questionSummary ?? "Current field kit list",
    replyStrategy: "Answer with the latest field kit guidance.",
    maskedExample: "Hi {NAME}, here is the current field kit list.",
    sourceKind: "hand_authored",
    approvedForAi: input?.approvedForAi ?? true,
    sourceEventId: null,
    metadataJson: {},
    lastReviewedAt: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  });
}
