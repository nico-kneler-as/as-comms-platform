import { describe, expect, it } from "vitest";

import {
  decodeQuotedPrintable,
  parseCommunicationPreview,
  resolvePreferredMessagePreview,
  sanitizePreviewText,
  stripSignature,
  trimQuotedReplyContent,
} from "../../app/inbox/_lib/message-formatting";

describe("inbox message formatting", () => {
  it("decodes quoted-printable HTML and removes MIME scaffolding", () => {
    const raw = [
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "<p>Hello&nbsp;team=21</p><p>We=E2=80=99re ready.</p>",
    ].join("\n");

    expect(sanitizePreviewText(raw)).toBe("Hello team!\nWe\u2019re ready.");
  });

  it("parses structured provider previews without flattening paragraphs", () => {
    const preview = parseCommunicationPreview(
      [
        "From: Example Volunteer <volunteer@example.com>",
        "To: Adventure Scientists <ops@example.org>",
        "Subject: Field update",
        "Body: Hi team,Thanks for the map.We are ready.This looks good.",
      ].join("\n"),
    );

    expect(preview).toMatchObject({
      structuredEmail: true,
      fromAddresses: ["volunteer@example.com"],
      recipientAddresses: ["ops@example.org"],
      subject: "Field update",
      body: [
        "Hi team,",
        "",
        "Thanks for the map.",
        "",
        "We are ready.",
        "",
        "This looks good.",
      ].join("\n"),
    });
  });

  it("trims quoted replies and forwarded headers from body previews", () => {
    expect(
      trimQuotedReplyContent(
        [
          "Fresh answer from the volunteer.",
          "",
          "On May 1, 2026, Adventure Scientists wrote:",
          "> Older message",
        ].join("\n"),
      ),
    ).toBe("Fresh answer from the volunteer.");

    expect(
      trimQuotedReplyContent(
        [
          "Here is the latest.",
          "",
          "From: Adventure Scientists <ops@example.org>",
          "Date: May 1, 2026 at 9:00 AM",
          "Subject: Earlier note",
        ].join("\n"),
      ),
    ).toBe("Here is the latest.");
  });

  it("strips signatures without removing conversational thanks", () => {
    expect(
      stripSignature(
        [
          "Thanks, Riley and Sam! This answers my question.",
          "",
          "Best,",
          "Example Volunteer",
        ].join("\n"),
      ),
    ).toBe("Thanks, Riley and Sam! This answers my question.");

    expect(
      stripSignature(
        "Best regards, Sam mentioned the confirmation timing in the paragraph above.",
      ),
    ).toBe(
      "Best regards, Sam mentioned the confirmation timing in the paragraph above.",
    );
  });

  it("resolves explicit subjects and direction metadata from candidate previews", () => {
    const resolved = resolvePreferredMessagePreview({
      explicitSubjects: ["  Explicit subject  "],
      rawCandidates: [
        [
          "From: Example Volunteer <volunteer@example.com>",
          "To: Adventure Scientists <ops@example.org>",
          "Subject: Provider subject",
          "Body: The body we should show.",
          "",
          "Thanks,",
          "Example Volunteer",
        ].join("\n"),
      ],
    });

    expect(resolved.subject).toBe("Explicit subject");
    expect(resolved.body).toBe("The body we should show.");
    expect(resolved.directionPreview).toMatchObject({
      structuredEmail: true,
      fromAddresses: ["volunteer@example.com"],
      recipientAddresses: ["ops@example.org"],
    });
  });

  it("keeps invalid quoted-printable sequences readable", () => {
    expect(decodeQuotedPrintable("Ready =ZZ still visible")).toBe(
      "Ready =ZZ still visible",
    );
  });

  it("normalizes control characters and glued sign-offs in previews", () => {
    expect(sanitizePreviewText("I don\u0019t see raw controls.")).toBe(
      "I don't see raw controls.",
    );

    const resolved = resolvePreferredMessagePreview({
      rawCandidates: [
        "Please can you send me a link to log inRegards�Tony Hoult�",
      ],
    });

    expect(resolved.body).toBe(
      "Please can you send me a link to log in",
    );
    expect(resolved.body).not.toContain("�");
  });
});
