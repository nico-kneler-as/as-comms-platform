import { describe, expect, it } from "vitest";

import {
  resolveCanonicalEventAudience,
  type CanonicalEventAudienceParticipant,
  type ResolveCanonicalEventAudienceInput,
} from "../src/index.js";

function participant(
  email: string,
  role: CanonicalEventAudienceParticipant["role"],
): CanonicalEventAudienceParticipant {
  return { email, role };
}

function resolve(
  input: Partial<ResolveCanonicalEventAudienceInput> = {},
): readonly CanonicalEventAudienceParticipant[] {
  return resolveCanonicalEventAudience({
    fromEmails: [],
    toEmails: [],
    ccEmails: [],
    bccEmails: [],
    ...input,
  }).participants;
}

describe("resolveCanonicalEventAudience", () => {
  it("resolves a single sender and direct recipient", () => {
    expect(
      resolve({
        fromEmails: ["a@example.org"],
        toEmails: ["b@example.org"],
      }),
    ).toEqual([
      participant("a@example.org", "sender"),
      participant("b@example.org", "direct_recipient"),
    ]);
  });

  it("sorts multi-recipient inbound participants by role then email", () => {
    expect(
      resolve({
        fromEmails: ["a@example.org"],
        toEmails: ["d@example.org", "b@example.org", "c@example.org"],
      }),
    ).toEqual([
      participant("a@example.org", "sender"),
      participant("b@example.org", "direct_recipient"),
      participant("c@example.org", "direct_recipient"),
      participant("d@example.org", "direct_recipient"),
    ]);
  });

  it("includes cc-only recipients", () => {
    expect(
      resolve({
        fromEmails: ["a@example.org"],
        ccEmails: ["c@example.org", "b@example.org"],
      }),
    ).toEqual([
      participant("a@example.org", "sender"),
      participant("b@example.org", "cc"),
      participant("c@example.org", "cc"),
    ]);
  });

  it("includes bcc recipients visible to the platform", () => {
    expect(
      resolve({
        fromEmails: ["a@example.org"],
        toEmails: ["b@example.org"],
        bccEmails: ["c@example.org"],
      }),
    ).toEqual([
      participant("a@example.org", "sender"),
      participant("b@example.org", "direct_recipient"),
      participant("c@example.org", "bcc"),
    ]);
  });

  it("orders participants across all four header positions", () => {
    expect(
      resolve({
        fromEmails: ["d@example.org"],
        toEmails: ["c@example.org"],
        ccEmails: ["b@example.org"],
        bccEmails: ["a@example.org"],
      }),
    ).toEqual([
      participant("d@example.org", "sender"),
      participant("c@example.org", "direct_recipient"),
      participant("b@example.org", "cc"),
      participant("a@example.org", "bcc"),
    ]);
  });

  it("prefers sender over direct recipient on collision", () => {
    expect(
      resolve({
        fromEmails: ["a@example.org"],
        toEmails: ["b@example.org", "a@example.org"],
      }),
    ).toEqual([
      participant("a@example.org", "sender"),
      participant("b@example.org", "direct_recipient"),
    ]);
  });

  it("prefers direct recipient over cc on collision", () => {
    expect(
      resolve({
        toEmails: ["a@example.org"],
        ccEmails: ["b@example.org", "a@example.org"],
      }),
    ).toEqual([
      participant("a@example.org", "direct_recipient"),
      participant("b@example.org", "cc"),
    ]);
  });

  it("prefers cc over bcc on collision", () => {
    expect(
      resolve({
        ccEmails: ["a@example.org"],
        bccEmails: ["b@example.org", "a@example.org"],
      }),
    ).toEqual([
      participant("a@example.org", "cc"),
      participant("b@example.org", "bcc"),
    ]);
  });

  it("collapses an email present in all four arrays to sender", () => {
    expect(
      resolve({
        fromEmails: ["a@example.org"],
        toEmails: ["a@example.org"],
        ccEmails: ["a@example.org"],
        bccEmails: ["a@example.org"],
      }),
    ).toEqual([participant("a@example.org", "sender")]);
  });

  it("deduplicates duplicates within the same array", () => {
    expect(
      resolve({
        toEmails: ["b@example.org", "a@example.org", "a@example.org"],
      }),
    ).toEqual([
      participant("a@example.org", "direct_recipient"),
      participant("b@example.org", "direct_recipient"),
    ]);
  });

  it("returns an empty participant list for empty input", () => {
    expect(resolve()).toEqual([]);
  });

  it("supports sender-only inputs", () => {
    expect(
      resolve({
        fromEmails: ["a@example.org"],
      }),
    ).toEqual([participant("a@example.org", "sender")]);
  });

  it("is deterministic across repeated calls and differing input order", () => {
    const input = {
      fromEmails: ["sender@example.org"],
      toEmails: ["b@example.org", "a@example.org"],
      ccEmails: ["d@example.org", "c@example.org"],
      bccEmails: ["f@example.org", "e@example.org"],
    } satisfies ResolveCanonicalEventAudienceInput;

    expect(resolveCanonicalEventAudience(input)).toEqual(
      resolveCanonicalEventAudience(input),
    );
    expect(resolveCanonicalEventAudience(input)).toEqual(
      resolveCanonicalEventAudience({
        fromEmails: ["sender@example.org"],
        toEmails: ["a@example.org", "b@example.org"],
        ccEmails: ["c@example.org", "d@example.org"],
        bccEmails: ["e@example.org", "f@example.org"],
      }),
    );
  });

  it("keeps the resolver scoped to per-message header emails for the Scotty alias case", () => {
    // The resolver is intentionally ignorant of volunteer/staff identity.
    // If Brick 3 passes only the actual message headers, only those aliases fan out.
    expect(
      resolve({
        fromEmails: ["or-rural-coordinator@adventurescientists.org"],
        toEmails: ["pnwbio@adventurescientists.org"],
      }),
    ).toEqual([
      participant("or-rural-coordinator@adventurescientists.org", "sender"),
      participant("pnwbio@adventurescientists.org", "direct_recipient"),
    ]);
  });
});
