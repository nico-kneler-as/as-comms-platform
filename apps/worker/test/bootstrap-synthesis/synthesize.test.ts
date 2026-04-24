import { describe, expect, it, vi } from "vitest";

import {
  synthesizeProjectKnowledge,
  type SynthesisModelInput,
  type SynthesisModelResult,
} from "../../src/jobs/bootstrap-project-knowledge/synthesize.js";

const source = {
  sourceId: "source:training",
  kind: "training_site" as const,
  label: "Training",
  url: "https://example.org/training",
  title: "Training",
  markdown:
    "Volunteers must complete the field safety module before deployment. The project portal contains the current kit checklist.",
  wordCount: 17,
};

function modelResult(text: string): SynthesisModelResult {
  return {
    text,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
    },
    stopReason: "end_turn",
    model: "claude-sonnet-4-6",
  };
}

describe("bootstrap synthesis", () => {
  it("extracts topics and drafts structured knowledge candidates", async () => {
    const calls: SynthesisModelInput[] = [];
    const responses = [
      modelResult(
        JSON.stringify([
          {
            topic: "Field safety training",
            evidence: [
              {
                sourceExcerpt:
                  "Volunteers must complete the field safety module before deployment.",
              },
            ],
          },
        ]),
      ),
      modelResult(
        JSON.stringify({
          kind: "canonical_reply",
          issueType: "training",
          volunteerStage: "pre-deployment",
          questionSummary: "What training is required before deployment?",
          replyStrategy:
            "Confirm that the field safety module is required before deployment.",
          maskedExample:
            "Hi {NAME}, please complete the field safety module before deployment.",
          sourceExcerpt:
            "Volunteers must complete the field safety module before deployment.",
        }),
      ),
    ];
    const invokeModel = vi.fn((input: SynthesisModelInput) => {
      calls.push(input);
      const response = responses.shift();
      if (response === undefined) {
        throw new Error("Unexpected model call.");
      }
      return Promise.resolve(response);
    });

    const result = await synthesizeProjectKnowledge({
      sources: [source],
      voiceGuide: "Be direct, warm, and specific.",
      invokeModel,
      estimateCostUsd: () => 0.01,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.messages[0]?.content).toContain(
      "Do NOT invent topics not present in the text.",
    );
    expect(calls[1]?.messages[0]?.content).toContain("[Tier 1 voice guide]");
    expect(result).toMatchInlineSnapshot(`
      {
        "candidates": [
          {
            "chunkId": "source:training:chunk:1",
            "issueType": "training",
            "kind": "canonical_reply",
            "maskedExample": "Hi {NAME}, please complete the field safety module before deployment.",
            "questionSummary": "What training is required before deployment?",
            "replyStrategy": "Confirm that the field safety module is required before deployment.",
            "sourceExcerpt": "Volunteers must complete the field safety module before deployment.",
            "topic": "Field safety training",
            "volunteerStage": "pre-deployment",
          },
        ],
        "costEstimateUsd": 0.02,
        "modelCalls": 2,
        "topicsFound": 1,
        "warnings": [],
      }
    `);
  });

  it("returns no candidates when topic extraction is empty", async () => {
    const result = await synthesizeProjectKnowledge({
      sources: [source],
      voiceGuide: null,
      invokeModel: () => Promise.resolve(modelResult("[]")),
      estimateCostUsd: () => 0,
    });

    expect(result).toMatchObject({
      candidates: [],
      topicsFound: 0,
      warnings: [],
    });
  });

  it("records warnings for malformed model JSON", async () => {
    const warn = vi.fn();
    const result = await synthesizeProjectKnowledge({
      sources: [source],
      voiceGuide: null,
      invokeModel: () => Promise.resolve(modelResult("not json")),
      estimateCostUsd: () => 0,
      logger: {
        warn,
      },
    });

    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual([
      "Malformed topic JSON for source:training:chunk:1.",
    ]);
    expect(warn).toHaveBeenCalled();
  });
});
