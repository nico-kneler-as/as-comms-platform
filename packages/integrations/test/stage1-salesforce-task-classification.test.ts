import { describe, expect, it } from "vitest";

import { classifySalesforceTaskMessageKind } from "../src/index.js";

describe("Salesforce Task message kind classification", () => {
  it.each(["Checking in", "→ Email: Start your training"])(
    "classifies Nim Admin-owned email tasks as auto: %s",
    (subject) => {
      expect(
        classifySalesforceTaskMessageKind({
          channel: "email",
          taskSubtype: "Email",
          ownerName: "Nim Admin",
          ownerUsername: "admin+1@adventurescientists.org",
          subject,
        }),
      ).toEqual({
        messageKind: "auto",
        reason: "automated_owner",
      });
    },
  );

  it("classifies an unprefixed Samantha-owned Salesforce send as auto", () => {
    expect(
      classifySalesforceTaskMessageKind({
        channel: "email",
        taskSubtype: "Email",
        ownerName: "Samantha Smith",
        ownerUsername: "samantha.smith@adventurescientists.org",
        subject: "Get Trained Today!",
      }),
    ).toEqual({
      messageKind: "auto",
      reason: "salesforce_sent_email",
    });
  });

  it.each(["→ Email: Re: question", "← Email: question"])(
    "keeps a prefixed Samantha-owned Task as one_to_one: %s",
    (subject) => {
      expect(
        classifySalesforceTaskMessageKind({
          channel: "email",
          taskSubtype: "Task",
          ownerName: "Samantha Smith",
          ownerUsername: "samantha.smith@adventurescientists.org",
          subject,
        }),
      ).toEqual({
        messageKind: "one_to_one",
        reason: "human_owned_task",
      });
    },
  );

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
