import { describe, expect, it } from "vitest";

import { classifySalesforceTaskMessageKind } from "../src/index.js";

describe("Salesforce Task message kind classification", () => {
  it("classifies Nim Admin-owned email tasks as auto", () => {
    expect(
      classifySalesforceTaskMessageKind({
        channel: "email",
        taskSubtype: "Email",
        ownerName: "Nim Admin",
        ownerUsername: "admin+1@adventurescientists.org",
        subject: "Checking in",
      }),
    ).toEqual({
      messageKind: "auto",
      reason: "automated_owner",
    });
  });

  it("classifies human-owned email tasks as one_to_one when the subject is not workflow-shaped", () => {
    expect(
      classifySalesforceTaskMessageKind({
        channel: "email",
        taskSubtype: "Email",
        ownerName: "Volunteer Coordinator",
        ownerUsername: "coordinator@example.org",
        subject: "Checking in about your expedition",
      }),
    ).toEqual({
      messageKind: "one_to_one",
      reason: "human_owned_task",
    });
  });

  it("keeps human-owned workflow-shaped subjects out of the auto bucket", () => {
    expect(
      classifySalesforceTaskMessageKind({
        channel: "email",
        taskSubtype: "Task",
        ownerName: "Volunteer Coordinator",
        ownerUsername: "coordinator@example.org",
        subject: "→ Email: Start your training",
      }),
    ).toEqual({
      messageKind: "one_to_one",
      reason: "human_owned_task",
    });
  });

  it("classifies workflow-shaped subjects as auto when owner metadata is missing", () => {
    expect(
      classifySalesforceTaskMessageKind({
        channel: "email",
        taskSubtype: "Task",
        subject: "→ Email: Start your training",
      }),
    ).toEqual({
      messageKind: "auto",
      reason: "subject_pattern",
    });
  });

  it("defaults ambiguous historical email tasks to auto", () => {
    expect(
      classifySalesforceTaskMessageKind({
        channel: "email",
        taskSubtype: null,
        ownerName: null,
        ownerUsername: null,
        subject: null,
      }),
    ).toEqual({
      messageKind: "auto",
      reason: "insufficient_metadata",
    });
  });
});
