import { describe, expect, it } from "vitest";

import { buildSkeletonDraft } from "../../../src/server/ai/fallback-builder";

describe("buildSkeletonDraft", () => {
  it("includes bracket placeholders", () => {
    expect(
      buildSkeletonDraft({
        inbound: "Can you send the current field kit list?",
        contact: {
          id: "contact:maya",
          salesforceContactId: null,
          displayName: "Maya Chen",
          primaryEmail: "maya@example.org",
          primaryPhone: null,
          createdAt: "2026-04-24T12:00:00.000Z",
          updatedAt: "2026-04-24T12:00:00.000Z",
        },
        warning: "grounding_empty",
      }),
    ).toContain("[Add the answer or next step here");
  });

  it("uses the contact first name when available", () => {
    expect(
      buildSkeletonDraft({
        inbound: "Can you send the current field kit list?",
        contact: {
          id: "contact:maya",
          salesforceContactId: null,
          displayName: "Maya Chen",
          primaryEmail: "maya@example.org",
          primaryPhone: null,
          createdAt: "2026-04-24T12:00:00.000Z",
          updatedAt: "2026-04-24T12:00:00.000Z",
        },
        warning: "provider_timeout",
      }),
    ).toContain("Hi Maya,");
  });

  it("leaves the first-name placeholder when no contact is available", () => {
    expect(
      buildSkeletonDraft({
        inbound: "",
        contact: null,
        warning: "grounding_empty",
      }),
    ).toContain("Hi {firstName},");
  });

  it("changes the skeleton wording based on the warning code", () => {
    expect(
      buildSkeletonDraft({
        inbound: "Need the field schedule",
        contact: null,
        warning: "provider_not_configured",
      }),
    ).toContain("[The AI assistant is unavailable right now.");
  });
});
