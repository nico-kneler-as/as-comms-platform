import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  cleanGmailBodyPreviewText,
  extractGmailBodyPreviewFromMimeMessage,
  gmailMessageRecordSchema,
  gmailMessageFullResponseSchema,
  mapLiveGmailMessageToRecord,
  trimQuotedReplyContent
} from "../src/index.js";

const fixturesDirectory = new URL("./fixtures/gmail/", import.meta.url);

async function readFixtureText(name: string): Promise<string> {
  return readFile(new URL(name, fixturesDirectory), "utf8");
}

describe("Gmail body extraction", () => {
  it("cleans flattened MIME previews without leaving scaffolding behind", async () => {
    const flattenedPreview = await readFixtureText("body-preview-flat-mime.txt");
    const cleanedPreview = cleanGmailBodyPreviewText(flattenedPreview);

    expect(cleanedPreview).toContain("Hello there. I don't understand.");
    expect(cleanedPreview).toContain(
      "I completed my training a week ago."
    );
    expect(cleanedPreview).not.toContain("Content-Type:");
    expect(cleanedPreview).not.toContain("Content-Transfer-Encoding:");
    expect(cleanedPreview).not.toContain("--00000000000027fc9f064e932947");
    expect(cleanedPreview).not.toContain("=C3=B3");
    expect(cleanedPreview).not.toContain("=E2=80=99");
  });

  it("extracts the text/plain body from multipart mbox messages and trims quoted replies", async () => {
    const mboxMessage = await readFixtureText("historical-message.mbox");
    const rawMessage = mboxMessage.replace(/^From .+\n/u, "");
    const bodyPreview = await extractGmailBodyPreviewFromMimeMessage({
      rawMessage
    });

    expect(bodyPreview).toBe(
      [
        "Hello there.",
        "I don't understand.",
        "I completed my training a week ago.",
        "",
        "Could you clarify why I need to do this again?",
        "I'm even accepted in Strava."
      ].join("\n")
    );
  });

  it("strips multi-dash MIME boundary markers from flattened previews", () => {
    expect(
      cleanGmailBodyPreviewText(
        "------=_Part_2324998_585856288.1775021416555\nrest of body"
      )
    ).toBe("rest of body");
  });

  it("maps live Gmail full payloads to decoded body previews instead of snippets", async () => {
    const fixtureJson = JSON.parse(
      await readFixtureText("live-message-full.json")
    ) as unknown;
    const fixture = gmailMessageFullResponseSchema.parse(fixtureJson);
    const record = await mapLiveGmailMessageToRecord({
      message: {
        id: fixture.id,
        threadId: fixture.threadId ?? null,
        snippet: fixture.snippet,
        internalDate: fixture.internalDate,
        payload: fixture.payload
      },
      capturedMailbox: "volunteers@example.org",
      liveAccount: "volunteers@example.org",
      projectInboxAliases: ["pnw@example.org"],
      receivedAt: "2026-03-26T10:16:00.000Z"
    });

    expect(record).toMatchObject({
      recordType: "message",
      snippet: "Thanks for the update. We can confirm your training is complete.",
      snippetClean:
        "Thanks for the update. We can confirm your training is complete.",
      bodyTextPreview:
        "Hello Silvia,\n\nThanks for the update. We can confirm your training is complete."
    });

    const messageRecord = gmailMessageRecordSchema.parse(record);

    expect(messageRecord.bodyTextPreview).not.toBe(messageRecord.snippet);
    expect(messageRecord.bodyTextPreview).not.toContain("=E2=80=99");
    expect(messageRecord.bodyTextPreview).not.toContain("Hi Silvia");
  });

  it("trims quoted reply chains after an On ... wrote marker", () => {
    expect(
      trimQuotedReplyContent(
        [
          "Thanks for the clarification.",
          "",
          "On Thu, Mar 26, 2026 at 9:15 AM PNW Forest Biodiversity <pnw@example.org> wrote:",
          "> Prior message"
        ].join("\n")
      )
    ).toBe("Thanks for the clarification.");
  });
});
