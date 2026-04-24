import { describe, expect, it } from "vitest";

import { buildDraftPrompt, buildFillPrompt, buildRepromptPrompt } from "../../../src/server/ai/prompt-builder";
import type { GroundingBundle } from "../../../src/server/ai/types";

const baseBundle: GroundingBundle = {
  contact: null,
  generalTraining: {
    id: "ai:global",
    scope: "global",
    scopeKey: null,
    sourceProvider: "notion",
    sourceId: "global",
    sourceUrl: "https://www.notion.so/global",
    title: "General Training",
    content: "Use a warm, direct, field-ready voice.",
    contentHash: "hash:global",
    metadataJson: {},
    sourceLastEditedAt: "2026-04-24T12:00:00.000Z",
    syncedAt: "2026-04-24T12:00:00.000Z",
    createdAt: "2026-04-24T12:00:00.000Z",
    updatedAt: "2026-04-24T12:00:00.000Z",
  },
  projectContext: {
    id: "ai:project:whitebark",
    scope: "project",
    scopeKey: "project:whitebark",
    sourceProvider: "notion",
    sourceId: "whitebark",
    sourceUrl: "https://www.notion.so/whitebark",
    title: "Whitebark Pines",
    content: "Whitebark volunteers should get the latest field kit guidance.",
    contentHash: "hash:whitebark",
    metadataJson: {},
    sourceLastEditedAt: "2026-04-24T12:00:00.000Z",
    syncedAt: "2026-04-24T12:00:00.000Z",
    createdAt: "2026-04-24T12:00:00.000Z",
    updatedAt: "2026-04-24T12:00:00.000Z",
  },
  tier3Entries: [],
  targetInbound: {
    canonicalEventId: "event:inbound-1",
    occurredAt: "2026-04-24T09:15:00.000Z",
    direction: "inbound",
    channel: "email",
    subject: "Whitebark kit",
    summary: "Whitebark kit",
    body: "Can you send the current field kit list?",
    threadId: "thread:maya",
  },
  recentEvents: [
    {
      canonicalEventId: "event:outbound-1",
      occurredAt: "2026-04-23T08:00:00.000Z",
      direction: "outbound",
      channel: "email",
      subject: "Re: Whitebark kit",
      summary: "Re: Whitebark kit",
      body: "Happy to help with the kit list.",
      threadId: "thread:maya",
    },
  ],
  grounding: [],
};

describe("prompt builder", () => {
  it("builds the draft prompt", () => {
    expect(
      buildDraftPrompt(baseBundle, {
        contactId: "contact:maya",
        projectId: "project:whitebark",
        threadCursor: "event:inbound-1",
        repromptIndex: 0,
        mode: "draft",
      }),
    ).toMatchInlineSnapshot(`
      {
        "messages": [
          {
            "content": "Inbound message:
      Can you send the current field kit list?
      
      Recent thread context:
      - 2026-04-23T08:00:00.000Z | outbound email
      Subject: Re: Whitebark kit
      Body: Happy to help with the kit list.
      
      Output ONLY the final reply text. Do not include any preamble, sign-off commentary, or marker text OTHER than the contradiction marker if triggered.",
            "role": "user",
          },
        ],
        "system": "[Tier 1 Voice Instructions]
      Use a warm, direct, field-ready voice.
      
      [Tier 2 Project Context]
      Whitebark volunteers should get the latest field kit guidance.
      
      [Tier 3 Canonical Examples]
      (No approved canonical examples are available.)
      
      The examples above are pattern support, not templates. Never copy any example verbatim. Adapt the style and structure to the current volunteer and project context.
      
      You are drafting a reply to a volunteer. Use only the information above and the inbound message. Never invent facts.",
      }
    `);
  });

  it("builds the fill prompt", () => {
    expect(
      buildFillPrompt(baseBundle, {
        contactId: "contact:maya",
        projectId: "project:whitebark",
        threadCursor: "event:inbound-1",
        repromptIndex: 0,
        mode: "fill",
        operatorPrompt: "Tell her the revised field kit will ship tomorrow.",
      }),
    ).toMatchInlineSnapshot(`
      {
        "messages": [
          {
            "content": "Inbound message:
      Can you send the current field kit list?
      
      Recent thread context:
      - 2026-04-23T08:00:00.000Z | outbound email
      Subject: Re: Whitebark kit
      Body: Happy to help with the kit list.

      Operator directive:
      Tell her the revised field kit will ship tomorrow.
      
      Expand the operator's directive into a complete reply in the voice and context above. If the directive contradicts the project context, produce the draft as directed AND emit a clear marker that the operator should reconfirm. Example marker: [NOTE: directive may conflict with project context — please verify X].
      
      Output ONLY the final reply text. Do not include any preamble, sign-off commentary, or marker text OTHER than the contradiction marker if triggered.",
            "role": "user",
          },
        ],
        "system": "[Tier 1 Voice Instructions]
      Use a warm, direct, field-ready voice.
      
      [Tier 2 Project Context]
      Whitebark volunteers should get the latest field kit guidance.
      
      [Tier 3 Canonical Examples]
      (No approved canonical examples are available.)
      
      The examples above are pattern support, not templates. Never copy any example verbatim. Adapt the style and structure to the current volunteer and project context.
      
      You are drafting a reply to a volunteer. Use only the information above and the inbound message. Never invent facts.",
      }
    `);
  });

  it("builds the reprompt prompt", () => {
    expect(
      buildRepromptPrompt(baseBundle, {
        contactId: "contact:maya",
        projectId: "project:whitebark",
        threadCursor: "event:inbound-1",
        repromptIndex: 1,
        mode: "reprompt",
        previousDraft: "Thanks for checking in.",
        repromptDirection: "Make it warmer and add the ship date.",
      }),
    ).toMatchInlineSnapshot(`
      {
        "messages": [
          {
            "content": "Inbound message:
      Can you send the current field kit list?
      
      Recent thread context:
      - 2026-04-23T08:00:00.000Z | outbound email
      Subject: Re: Whitebark kit
      Body: Happy to help with the kit list.

      Previous draft:
      Thanks for checking in.
      
      Reprompt direction:
      Make it warmer and add the ship date.
      
      Revise the previous draft in light of the direction. Keep the voice and grounding constraints.
      
      Output ONLY the final reply text. Do not include any preamble, sign-off commentary, or marker text OTHER than the contradiction marker if triggered.",
            "role": "user",
          },
        ],
        "system": "[Tier 1 Voice Instructions]
      Use a warm, direct, field-ready voice.
      
      [Tier 2 Project Context]
      Whitebark volunteers should get the latest field kit guidance.
      
      [Tier 3 Canonical Examples]
      (No approved canonical examples are available.)
      
      The examples above are pattern support, not templates. Never copy any example verbatim. Adapt the style and structure to the current volunteer and project context.
      
      You are drafting a reply to a volunteer. Use only the information above and the inbound message. Never invent facts.",
      }
    `);
  });

  it("renders empty sections when tier-1 or tier-2 grounding is missing", () => {
    expect(
      buildDraftPrompt(
        {
          ...baseBundle,
          generalTraining: null,
          projectContext: null,
        },
        {
          contactId: "contact:maya",
          projectId: null,
          threadCursor: null,
          repromptIndex: 0,
          mode: "draft",
        },
      ),
    ).toMatchInlineSnapshot(`
      {
        "messages": [
          {
            "content": "Inbound message:
      Can you send the current field kit list?
      
      Recent thread context:
      - 2026-04-23T08:00:00.000Z | outbound email
      Subject: Re: Whitebark kit
      Body: Happy to help with the kit list.
      
      Output ONLY the final reply text. Do not include any preamble, sign-off commentary, or marker text OTHER than the contradiction marker if triggered.",
            "role": "user",
          },
        ],
        "system": "[Tier 1 Voice Instructions]
      (No global voice instructions are available.)
      
      [Tier 2 Project Context]
      (No project-specific context is available.)
      
      [Tier 3 Canonical Examples]
      (No approved canonical examples are available.)
      
      The examples above are pattern support, not templates. Never copy any example verbatim. Adapt the style and structure to the current volunteer and project context.
      
      You are drafting a reply to a volunteer. Use only the information above and the inbound message. Never invent facts.",
      }
    `);
  });

  it("renders tier-3 examples between project context and the inbound", () => {
    expect(
      buildDraftPrompt(
        {
          ...baseBundle,
          tier3Entries: [
            {
              id: "knowledge:field-kit",
              projectId: "project:whitebark",
              kind: "canonical_reply",
              issueType: "Trip planning",
              volunteerStage: null,
              questionSummary: "Current field kit list",
              replyStrategy: "Confirm the latest kit source and invite follow-up.",
              maskedExample:
                "Hi {NAME}, the latest kit list is in the volunteer portal.",
              sourceKind: "hand_authored",
              approvedForAi: true,
              sourceEventId: null,
              metadataJson: {},
              lastReviewedAt: null,
              createdAt: "2026-04-24T12:00:00.000Z",
              updatedAt: "2026-04-24T12:00:00.000Z",
            },
          ],
        },
        {
          contactId: "contact:maya",
          projectId: "project:whitebark",
          threadCursor: "event:inbound-1",
          repromptIndex: 0,
          mode: "draft",
        },
      ).system,
    ).toContain(
      "[Tier 3 Canonical Examples]\n• [Issue: Trip planning] Q: Current field kit list\n  Strategy: Confirm the latest kit source and invite follow-up.\n  Example: Hi {NAME}, the latest kit list is in the volunteer portal.",
    );
  });
});
