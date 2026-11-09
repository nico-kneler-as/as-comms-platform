import { describe, expect, it } from "vitest";

import {
  createExpeditionWithdrawToken,
  verifyExpeditionWithdrawToken,
} from "../src/expedition-withdraw-token.js";

const secret = "a-very-long-test-secret-that-is-at-least-32-characters";
const payload = {
  expeditionMemberId: "a0B000000000001",
  projectId: "a0P000000000001",
};
const now = new Date("2026-11-09T12:00:00.000Z");

function token(): string {
  return createExpeditionWithdrawToken({
    ...payload,
    secret,
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  });
}

function createToken(input: {
  readonly expeditionMemberId?: string;
  readonly projectId?: string;
  readonly expiresAt?: Date;
} = {}): string {
  return createExpeditionWithdrawToken({
    expeditionMemberId: input.expeditionMemberId ?? payload.expeditionMemberId,
    projectId: input.projectId ?? payload.projectId,
    secret,
    expiresAt: input.expiresAt ?? new Date("2027-01-01T00:00:00.000Z"),
  });
}

describe("expedition withdraw tokens", () => {
  it("round trips a signed token", () => {
    expect(verifyExpeditionWithdrawToken(token(), { secret, now })).toEqual(payload);
  });

  it("rejects a changed final signature character", () => {
    const original = token();
    const changedFinalCharacter = `${original.slice(0, -1)}${original.endsWith("A") ? "B" : "A"}`;

    expect(
      verifyExpeditionWithdrawToken(changedFinalCharacter, { secret, now }),
    ).toBeNull();
  });

  it("rejects tampering in each signed segment and a wrong secret", () => {
    const original = token();
    const segments = original.split(".");
    for (let index = 0; index < segments.length; index += 1) {
      const changed = [...segments];
      changed[index] = `${changed[index] ?? ""}x`;
      expect(verifyExpeditionWithdrawToken(changed.join("."), { secret, now })).toBeNull();
    }
    expect(verifyExpeditionWithdrawToken(original, { secret: `${secret}x`, now })).toBeNull();
  });

  it("accepts 15-character Salesforce ids and rejects non-alphanumeric ids", () => {
    const shortId = "a0B000000000001";
    const shortProjectId = "a0P000000000001";

    expect(
      verifyExpeditionWithdrawToken(
        createToken({ expeditionMemberId: shortId, projectId: shortProjectId }),
        { secret, now },
      ),
    ).toEqual({ expeditionMemberId: shortId, projectId: shortProjectId });
    expect(() => createToken({ expeditionMemberId: "a0B00000000000-" })).toThrow(
      "Invalid expedition withdraw token input.",
    );
    expect(() => createToken({ projectId: "a0P00000000000_" })).toThrow(
      "Invalid expedition withdraw token input.",
    );
  });

  it("accepts expiry exactly now and rejects an expiry one second ago", () => {
    const original = token();
    const expiresNow = createToken({ expiresAt: now });
    const expired = createToken({
      expiresAt: new Date(now.getTime() - 1_000),
    });

    expect(verifyExpeditionWithdrawToken(expiresNow, { secret, now })).toEqual(payload);
    expect(verifyExpeditionWithdrawToken(original, {
      secret,
      now: new Date("2028-01-01T00:00:00.000Z"),
    })).toBeNull();
    expect(verifyExpeditionWithdrawToken(expired, { secret, now })).toBeNull();
  });

  it("rejects malformed segments", () => {
    const original = token();
    for (const malformed of [
      "x1.a0B000000000001.a0P000000000001.1800000000.signature",
      "w1.bad.a0P000000000001.1800000000.signature",
      "w1.a0B000000000001.a0P000000000001.1800000000",
      `${original}.extra`,
    ]) {
      expect(verifyExpeditionWithdrawToken(malformed, { secret, now })).toBeNull();
    }
  });
});
