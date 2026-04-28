import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  cleanGmailBodyPreviewText,
  collectGmailAttachmentMetadata,
  extractDsnOriginalMessageId,
  extractGmailBodyPreviewFromMimeMessageResult,
  extractGmailBodyPreviewFromPayloadResult,
  extractGmailBodyPreviewFromMimeMessage,
  gmailMessageRecordSchema,
  gmailMessageFullResponseSchema,
  mapLiveGmailMessageToRecord,
  type GmailApiMessagePart,
  trimQuotedReplyContent
} from "../src/index.js";

const fixturesDirectory = new URL("./fixtures/gmail/", import.meta.url);

async function readFixtureText(name: string): Promise<string> {
  return readFile(new URL(name, fixturesDirectory), "utf8");
}

async function readFixtureJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFixtureText(name)) as T;
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

  it("stores an encrypted placeholder for application/pkcs7-mime payloads", async () => {
    const payload = await readFixtureJson<GmailApiMessagePart>(
      "encrypted-pkcs7-payload.json"
    );

    await expect(extractGmailBodyPreviewFromPayloadResult(payload)).resolves.toEqual(
      {
        bodyTextPreview: "[Encrypted message — open in Gmail to read]",
        bodyKind: "encrypted_placeholder",
      }
    );
  });

  it("stores an encrypted placeholder for multipart/encrypted MIME messages", async () => {
    const rawMessage = await readFixtureText("encrypted-multipart.mbox");
    const parsed = await extractGmailBodyPreviewFromMimeMessageResult({
      rawMessage: rawMessage.replace(/^From .+\n/u, ""),
    });

    expect(parsed).toEqual({
      bodyTextPreview: "[Encrypted message — open in Gmail to read]",
      bodyKind: "encrypted_placeholder",
    });
  });

  it("stores a binary fallback placeholder when a multipart payload has no text parts", async () => {
    const payload = await readFixtureJson<GmailApiMessagePart>(
      "binary-only-payload.json"
    );

    await expect(extractGmailBodyPreviewFromPayloadResult(payload)).resolves.toEqual(
      {
        bodyTextPreview:
          "[Message body could not be extracted — open in Gmail]",
        bodyKind: "binary_fallback",
      }
    );
  });

  it("collects attachment metadata while skipping inline data and signature wrappers", () => {
    const payload: GmailApiMessagePart = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "image/png",
          filename: "inline.png",
          body: {
            data: Buffer.from("inline", "utf8").toString("base64url"),
            size: 6,
          },
        },
        {
          mimeType: "image/jpeg",
          filename: "field-photo.jpg",
          body: {
            attachmentId: "att-image",
            size: 12_345,
          },
        },
        {
          mimeType: "application/pdf",
          filename: "packet.pdf",
          body: {
            attachmentId: "att-pdf",
            size: 98_765,
          },
        },
        {
          mimeType: "application/pkcs7-signature",
          filename: "smime.p7s",
          body: {
            attachmentId: "att-signature",
            size: 512,
          },
        },
      ],
    };

    expect(collectGmailAttachmentMetadata(payload)).toEqual([
      {
        partIndexPath: "1",
        mimeType: "image/jpeg",
        filename: "field-photo.jpg",
        sizeBytes: 12_345,
        gmailAttachmentId: "att-image",
      },
      {
        partIndexPath: "2",
        mimeType: "application/pdf",
        filename: "packet.pdf",
        sizeBytes: 98_765,
        gmailAttachmentId: "att-pdf",
      },
    ]);
  });

  it("treats a text/plain part containing decoded binary noise as a binary fallback", async () => {
    // Lone UTF-8 continuation bytes (0x80..0xBF) without lead bytes — each one
    // decodes to U+FFFD, producing a body with ~50% replacement characters.
    // This is the same shape we observe in production for S/MIME envelopes
    // misdeclared as text/plain (e.g. tetratech.com Tetra Tech Outlook S/MIME).
    const binaryBytes = Buffer.alloc(80);
    for (let i = 0; i < 40; i += 1) {
      binaryBytes[i * 2] = 0x80 + (i % 0x40);
      binaryBytes[i * 2 + 1] = 0x21 + (i % 0x40);
    }

    const payload: GmailApiMessagePart = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "text/plain",
          headers: [
            { name: "Content-Type", value: "text/plain; charset=utf-8" }
          ],
          body: {
            data: binaryBytes
              .toString("base64")
              .replace(/\+/g, "-")
              .replace(/\//g, "_")
              .replace(/=+$/u, "")
          }
        }
      ]
    };

    await expect(
      extractGmailBodyPreviewFromPayloadResult(payload)
    ).resolves.toEqual({
      bodyTextPreview: "[Message body could not be extracted — open in Gmail]",
      bodyKind: "binary_fallback"
    });
  });

  it("preserves a normal email body that contains a handful of stray control characters", async () => {
    // Mirrors the OpenAI marketing-email shape from production: ~7%
    // replacement-or-control chars in an otherwise readable body. These must
    // stay rendered as plaintext, not be replaced with the fallback.
    const noisyText =
      "Greetings from the Pod!\n\nThank you for being a part of the project. " +
      "Many communities have been impacted by recent rainfall and flooding. " +
      "Stay safe out there.\n\nO O O O — Project Team";

    const payload: GmailApiMessagePart = {
      mimeType: "multipart/alternative",
      parts: [
        {
          mimeType: "text/plain",
          headers: [
            { name: "Content-Type", value: "text/plain; charset=utf-8" }
          ],
          body: {
            data: Buffer.from(noisyText, "utf8")
              .toString("base64")
              .replace(/\+/g, "-")
              .replace(/\//g, "_")
              .replace(/=+$/u, "")
          }
        }
      ]
    };

    const result = await extractGmailBodyPreviewFromPayloadResult(payload);
    expect(result.bodyKind).toBe("plaintext");
    expect(result.bodyTextPreview).toContain("Greetings from the Pod!");
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
        labelIds: fixture.labelIds,
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

  it("does not trim plain body content that happens to include From and Sent lines", () => {
    expect(
      trimQuotedReplyContent(
        [
          "Hello Samantha,",
          "Here is an update on placing the ARUs.",
          "From: Basin Ridge",
          "Sent: after the snow melted"
        ].join("\n")
      )
    ).toBe(
      [
        "Hello Samantha,",
        "Here is an update on placing the ARUs.",
        "From: Basin Ridge",
        "Sent: after the snow melted"
      ].join("\n")
    );
  });

  it("does not treat a normal sentence containing 'on' as an On ... wrote quote marker", () => {
    expect(
      trimQuotedReplyContent(
        [
          "Hello Samantha,",
          "",
          "Here is an update on placing the ARUs for HEX 08456.",
          "",
          "On Fri, Apr 3, 2026 at 12:19 PM PNW Forest Biodiversity wrote:",
          "> Prior message"
        ].join("\n")
      )
    ).toBe(
      [
        "Hello Samantha,",
        "",
        "Here is an update on placing the ARUs for HEX 08456."
      ].join("\n")
    );
  });

  it("does not truncate Spark-style replies at the casual word 'on' before the quoted-reply marker", async () => {
    const mboxMessage = await readFixtureText("spark-casual-on.mbox");
    const rawMessage = mboxMessage.replace(/^From .+\n/u, "");
    const bodyPreview = await extractGmailBodyPreviewFromMimeMessage({
      rawMessage
    });

    expect(bodyPreview).toContain("Thank you for these directions");
    expect(bodyPreview).toContain("I am planning on picking up my ARUs");
    expect(bodyPreview).toContain("Have a great week");
    expect(bodyPreview).toContain("Volunteer Name");
    expect(bodyPreview).not.toContain("On Mon, Apr 6, 2026");
    expect(bodyPreview).not.toContain("> Hi Volunteer");
  });

  it("preserves bodies longer than 2000 characters", () => {
    const longBody = `Hello Samantha,\n\n${"A".repeat(2_600)}`;

    expect(cleanGmailBodyPreviewText(longBody)).toBe(longBody);
  });

  it("extracts the original message id from a delivery-status MIME part", () => {
    const payload: GmailApiMessagePart = {
      mimeType: "multipart/report",
      parts: [
        {
          mimeType: "message/delivery-status",
          body: {
            data: Buffer.from(
              [
                "Reporting-MTA: dns; googlemail.com",
                "Final-Recipient: rfc822; volunteer@example.org",
                "Original-Message-ID: <123.abcde-67890@example.org>",
              ].join("\r\n"),
              "utf8",
            )
              .toString("base64")
              .replace(/\+/g, "-")
              .replace(/\//g, "_")
              .replace(/=+$/u, ""),
          },
        },
      ],
    };

    expect(extractDsnOriginalMessageId(payload)).toBe(
      "<123.abcde-67890@example.org>",
    );
  });

  it("returns null when no DSN-bearing MIME parts exist", () => {
    const payload: GmailApiMessagePart = {
      mimeType: "multipart/alternative",
      parts: [
        {
          mimeType: "text/plain",
          body: {
            data: Buffer.from("Normal body", "utf8")
              .toString("base64")
              .replace(/\+/g, "-")
              .replace(/\//g, "_")
              .replace(/=+$/u, ""),
          },
        },
      ],
    };

    expect(extractDsnOriginalMessageId(payload)).toBeNull();
  });
});
