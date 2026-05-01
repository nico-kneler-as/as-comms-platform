import { describe, expect, it } from "vitest";

import {
  resolveTaskChannel,
  type SalesforceTaskChannelConfig,
} from "../src/index.js";

const defaultChannelConfig: SalesforceTaskChannelConfig = {
  taskChannelField: "TaskSubtype",
  taskEmailChannelValues: ["Email"],
  taskSmsChannelValues: ["SMS", "Text"],
};

function makeRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    Id: "00TVK00000test1",
    TaskSubtype: "Task",
    Subject: "Plan your Adventure Today!",
    Owner: {
      Username: "admin+1@adventurescientists.org",
      Name: "Nim Admin",
    },
    ...overrides,
  };
}

describe("resolveTaskChannel F.1 owner-trust extension", () => {
  it("returns email for Task subtype rows owned by the launch-scope automation user", () => {
    expect(
      resolveTaskChannel({
        row: makeRow(),
        relatedMembership: { Id: "a01-membership" },
        config: defaultChannelConfig,
      }),
    ).toBe("email");
  });

  it("trusts launch-scope owners on Task subtype rows without a related membership (F.1 widen)", () => {
    expect(
      resolveTaskChannel({
        row: makeRow(),
        relatedMembership: null,
        config: defaultChannelConfig,
      }),
    ).toBe("email");
  });

  it("does not match Call subtype even for launch-scope owners with null membership", () => {
    expect(
      resolveTaskChannel({
        row: makeRow({ TaskSubtype: "Call" }),
        relatedMembership: null,
        config: defaultChannelConfig,
      }),
    ).toBeNull();
  });

  it("does not trust non-launch-scope owners on Task subtype with null membership", () => {
    expect(
      resolveTaskChannel({
        row: makeRow({
          Owner: {
            Username: "ricky@adventurescientists.org",
            Name: "Ricky",
          },
        }),
        relatedMembership: null,
        config: defaultChannelConfig,
      }),
    ).toBeNull();
  });

  it("preserves the legacy email subject heuristic with null membership", () => {
    expect(
      resolveTaskChannel({
        row: makeRow({
          Owner: {
            Username: "ricky@adventurescientists.org",
            Name: "Ricky",
          },
          Subject: "→ Email: Hello",
        }),
        relatedMembership: null,
        config: defaultChannelConfig,
      }),
    ).toBe("email");
  });

  it("does not trust non-launch-scope owners without the legacy subject heuristic", () => {
    expect(
      resolveTaskChannel({
        row: makeRow({
          Owner: {
            Username: "ricky@adventurescientists.org",
            Name: "Ricky",
          },
        }),
        relatedMembership: { Id: "a01-membership" },
        config: defaultChannelConfig,
      }),
    ).toBeNull();
  });

  it("matches launch-scope owners case-insensitively", () => {
    expect(
      resolveTaskChannel({
        row: makeRow({
          Owner: {
            Username: "ADMIN+1@ADVENTURESCIENTISTS.ORG",
            Name: "Nim Admin",
          },
        }),
        relatedMembership: { Id: "a01-membership" },
        config: defaultChannelConfig,
      }),
    ).toBe("email");
  });

  it("preserves the legacy email subject heuristic for non-launch-scope owners", () => {
    expect(
      resolveTaskChannel({
        row: makeRow({
          Owner: {
            Username: "ricky@adventurescientists.org",
            Name: "Ricky",
          },
          Subject: "→ Email: Hello",
        }),
        relatedMembership: { Id: "a01-membership" },
        config: defaultChannelConfig,
      }),
    ).toBe("email");
  });

  it("still returns email for TaskSubtype=Email rows", () => {
    expect(
      resolveTaskChannel({
        row: makeRow({
          TaskSubtype: "Email",
          Owner: {
            Username: "ricky@adventurescientists.org",
            Name: "Ricky",
          },
          Subject: "anything",
        }),
        relatedMembership: { Id: "a01-membership" },
        config: defaultChannelConfig,
      }),
    ).toBe("email");
  });
});
