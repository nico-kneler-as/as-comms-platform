import { describe, expect, it } from "vitest";

import {
  decodeQuotedPrintable,
  parseCommunicationPreview,
  resolvePreferredMessagePreview,
  sanitizePreviewText,
  stripDuplicateOutboundEcho,
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

  describe("stripDuplicateOutboundEcho", () => {
    it("trims outlook-style exact outbound echoes", () => {
      expect(
        stripDuplicateOutboundEcho({
          inboundBody:
            "Hi, thanks for reaching out! Yes, I'll be there.\n\nHey Tammy, Could you try the link again and see if you now have access?",
          recentOutboundBody:
            "Hey Tammy, Could you try the link again and see if you now have access?",
        }),
      ).toBe("Hi, thanks for reaching out! Yes, I'll be there.");
    });

    it("does not trim paraphrased outbound echoes", () => {
      const inboundBody = [
        "Hi, thanks for reaching out! Yes, I'll be there.",
        "",
        "Hey Tammy, please try the link again and see whether access is working now.",
      ].join("\n");

      expect(
        stripDuplicateOutboundEcho({
          inboundBody,
          recentOutboundBody:
            "Hey Tammy, Could you try the link again and see if you now have access?",
        }),
      ).toBe(inboundBody);
    });

    it("is a no-op when quote markers already let the outer trimmer work", () => {
      const inboundBody = trimQuotedReplyContent(
        [
          "Hi, thanks for reaching out! Yes, I'll be there.",
          "",
          "On May 1, 2026, Adventure Scientists wrote:",
          "Hey Tammy, Could you try the link again and see if you now have access?",
        ].join("\n"),
      );

      expect(
        stripDuplicateOutboundEcho({
          inboundBody,
          recentOutboundBody:
            "Hey Tammy, Could you try the link again and see if you now have access?",
        }),
      ).toBe("Hi, thanks for reaching out! Yes, I'll be there.");
    });

    it("is a no-op when outbound is null", () => {
      const inboundBody = "Hi, thanks for reaching out! Yes, I'll be there.";

      expect(
        stripDuplicateOutboundEcho({
          inboundBody,
          recentOutboundBody: null,
        }),
      ).toBe(inboundBody);
    });

    it("does not trim when the match starts at character 0", () => {
      const inboundBody =
        "Hey Tammy, Could you try the link again and see if you now have access?";

      expect(
        stripDuplicateOutboundEcho({
          inboundBody,
          recentOutboundBody: inboundBody,
        }),
      ).toBe(inboundBody);
    });

    it("strips outbound signatures before matching", () => {
      expect(
        stripDuplicateOutboundEcho({
          inboundBody:
            "Hi, thanks for reaching out! Yes, I'll be there.\n\nHey Tammy, Could you try the link again and see if you now have access?",
          recentOutboundBody: [
            "Hey Tammy, Could you try the link again and see if you now have access?",
            "",
            "Best,",
            "Samantha",
          ].join("\n"),
        }),
      ).toBe("Hi, thanks for reaching out! Yes, I'll be there.");
    });
  });
});
