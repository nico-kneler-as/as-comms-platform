import { describe, expect, it } from "vitest";

import { validateDraft } from "../../../src/server/ai/validator";
import type { GroundingBundle } from "../../../src/server/ai/types";

const bundle: GroundingBundle = {
  contact: null,
  generalTraining: {
    id: "ai:global",
    scope: "global",
    scopeKey: null,
    sourceProvider: "notion",
    sourceId: "global",
    sourceUrl: null,
    title: "General Training",
    content:
      "Use a warm, direct, field-ready voice. Keep replies concise and factual.",
    contentHash: "hash:global",
    metadataJson: {},
    sourceLastEditedAt: "2026-04-24T12:00:00.000Z",
    syncedAt: "2026-04-24T12:00:00.000Z",
    createdAt: "2026-04-24T12:00:00.000Z",
    updatedAt: "2026-04-24T12:00:00.000Z",
  },
  projectContext: null,
  tier3Entries: [],
  targetInbound: null,
  recentEvents: [],
  grounding: [],
};

describe("validateDraft", () => {
  it("rejects empty drafts", () => {
    expect(validateDraft("   ", bundle)).toMatchObject({
      ok: false,
      reasons: ["Draft output was empty."],
    });
  });

  it("rejects drafts with masked placeholder residue", () => {
    const result = validateDraft("Hi {NAME}, please email {EMAIL}.", bundle);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain(
      "Draft output still contains training placeholders.",
    );
  });

  it("rejects drafts with more than fifty percent verbatim overlap with tier one", () => {
    const result = validateDraft(
      "Use a warm direct field ready voice keep replies concise and factual.",
      bundle,
    );

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain(
      "Draft output echoes the tier-1 voice guidance too closely.",
    );
  });

  it("accepts a normal draft", () => {
    expect(
      validateDraft(
        "Hi Maya,\n\nThanks for checking in. I’ll send the updated kit list this afternoon.\n\nBest,",
        bundle,
      ),
    ).toEqual({
      ok: true,
      reasons: [],
    });
  });

  it("rejects drafts that copy a tier-3 masked example", () => {
    const result = validateDraft(
      "Hi Maya, the latest kit list is in the volunteer portal and you can check it today.",
      {
        ...bundle,
        tier3Entries: [
          {
            id: "knowledge:kit",
            projectId: "project:whitebark",
            kind: "canonical_reply",
            issueType: "Trip planning",
            volunteerStage: null,
            questionSummary: "Current kit list",
            replyStrategy: null,
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
    );

    expect(result.ok).toBe(false);
    expect(result.reasons).toContain(
      "Draft output copies too much language from a tier-3 canonical example.",
    );
  });
});
