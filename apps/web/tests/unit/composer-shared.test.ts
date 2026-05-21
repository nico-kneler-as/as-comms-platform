import { afterEach, describe, expect, it, vi } from "vitest";

import { formatContactRecipientLabel } from "../../app/inbox/_lib/composer-ui";
import {
  autoResizeTextarea,
  formatBytes,
  mapFieldErrors,
  readFileAsAttachment,
  resolveAiWarningMessage,
  resolveComposerDraftKey,
  resolveRecipientEmailAddress,
  resolveRecipientLabel,
} from "../../app/inbox/_components/composer-shared";
import type { ComposerRecipientValue } from "../../app/inbox/_components/composer-recipient-picker";
import type { UiError } from "../../src/server/ui-result";

class MockFileReader {
  static nextResult: string | ArrayBuffer | null = null;
  static nextError: Error | null = null;

  result: string | ArrayBuffer | null = null;
  error: Error | null = null;
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;

  readAsDataURL() {
    if (MockFileReader.nextError) {
      this.error = MockFileReader.nextError;
      this.onerror?.();
      return;
    }

    this.result = MockFileReader.nextResult;
    this.onload?.();
  }
}

function createContactRecipient(
  overrides: Partial<Extract<ComposerRecipientValue, { kind: "contact" }>> = {},
): Extract<ComposerRecipientValue, { kind: "contact" }> {
  return {
    kind: "contact",
    contactId: "contact-123",
    displayName: "Jane Volunteer",
    primaryEmail: "Jane.Volunteer@Example.com",
    primaryProjectName: null,
    salesforceContactId: "003-contact",
    ...overrides,
  };
}

function createEmailRecipient(
  overrides: Partial<Extract<ComposerRecipientValue, { kind: "email" }>> = {},
): Extract<ComposerRecipientValue, { kind: "email" }> {
  return {
    kind: "email",
    emailAddress: "  Person@Example.com ",
    ...overrides,
  };
}

describe("composer-shared", () => {
  afterEach(() => {
    MockFileReader.nextResult = null;
    MockFileReader.nextError = null;
    vi.unstubAllGlobals();
  });

  describe("resolveRecipientEmailAddress", () => {
    it("normalizes an email recipient address", () => {
      expect(
        resolveRecipientEmailAddress(createEmailRecipient()),
      ).toBe("person@example.com");
    });

    it("returns the normalized primary email for contact recipients", () => {
      expect(
        resolveRecipientEmailAddress(createContactRecipient()),
      ).toBe("jane.volunteer@example.com");
    });

    it("returns null for contact recipients without a primary email", () => {
      expect(
        resolveRecipientEmailAddress(
          createContactRecipient({ primaryEmail: null }),
        ),
      ).toBeNull();
    });
  });

  describe("formatBytes", () => {
    it("returns bytes below one kilobyte in B", () => {
      expect(formatBytes(999)).toBe("999 B");
    });

    it("rounds kilobytes between one kilobyte and one megabyte", () => {
      expect(formatBytes(1_537)).toBe("2 KB");
    });

    it("formats megabytes with one decimal place", () => {
      expect(formatBytes(1_572_864)).toBe("1.5 MB");
    });
  });

  describe("resolveRecipientLabel", () => {
    it("uses the real contact label formatter for contact recipients", () => {
      const recipient = createContactRecipient();

      expect(resolveRecipientLabel(recipient)).toBe(
        formatContactRecipientLabel({
          displayName: recipient.displayName,
          primaryEmail: recipient.primaryEmail,
        }),
      );
    });

    it("returns email addresses as-is for email recipients", () => {
      expect(
        resolveRecipientLabel(createEmailRecipient({ emailAddress: "User@Example.com" })),
      ).toBe("User@Example.com");
    });
  });

  describe("resolveComposerDraftKey", () => {
    it("returns null when no recipient is selected", () => {
      expect(
        resolveComposerDraftKey({
          actorId: "actor-1",
          recipient: null,
        }),
      ).toBeNull();
    });

    it("builds contact draft keys from actor and contact ids", () => {
      expect(
        resolveComposerDraftKey({
          actorId: "actor-1",
          recipient: createContactRecipient({ contactId: "contact-9" }),
        }),
      ).toBe("composer-draft:v1:actor-1:contact-9:contact");
    });

    it("builds email draft keys from normalized email addresses", () => {
      expect(
        resolveComposerDraftKey({
          actorId: "actor-1",
          recipient: createEmailRecipient({ emailAddress: "  Mixed@Example.com " }),
        }),
      ).toBe("composer-draft:v1:actor-1:email:mixed@example.com");
    });
  });

  describe("mapFieldErrors", () => {
    it("returns an empty array when fieldErrors is missing", () => {
      expect(mapFieldErrors({} as Pick<UiError, "fieldErrors">)).toEqual([]);
    });

    it("maps known and prefixed fields to composer validation fields", () => {
      expect(
        mapFieldErrors({
          fieldErrors: {
            alias: "Alias issue",
            subject: "Subject issue",
            attachments: "Attachment issue",
            sender: "Sender issue",
            senderId: "Sender id issue",
            body: "Body issue",
            bodyPlaintext: "Plain body issue",
            bodyHtml: "Html body issue",
            recipientEmail: "Recipient issue",
            cc0: "Cc issue",
            bccPrimary: "Bcc issue",
          },
        }),
      ).toEqual([
        { field: "alias", message: "Alias issue" },
        { field: "subject", message: "Subject issue" },
        { field: "attachments", message: "Attachment issue" },
        { field: "sender", message: "Sender issue" },
        { field: "sender", message: "Sender id issue" },
        { field: "body", message: "Body issue" },
        { field: "body", message: "Plain body issue" },
        { field: "body", message: "Html body issue" },
        { field: "recipient", message: "Recipient issue" },
        { field: "cc", message: "Cc issue" },
        { field: "bcc", message: "Bcc issue" },
      ]);
    });

    it("drops unknown fields", () => {
      expect(
        mapFieldErrors({
          fieldErrors: {
            mystery: "Ignore me",
          },
        }),
      ).toEqual([]);
    });
  });

  describe("autoResizeTextarea", () => {
    it("resets the height and then applies the scrollHeight when under the cap", () => {
      const style = { height: "123px" };
      const textarea = {
        scrollHeight: 120,
        style,
      } as HTMLTextAreaElement;

      autoResizeTextarea(textarea);

      expect(style.height).toBe("120px");
    });

    it("caps the textarea height at twenty lines", () => {
      const style = { height: "48px" };
      const textarea = {
        scrollHeight: 900,
        style,
      } as HTMLTextAreaElement;

      autoResizeTextarea(textarea);

      expect(style.height).toBe("480px");
    });
  });

  describe("readFileAsAttachment", () => {
    it("returns the expected attachment draft fields", async () => {
      MockFileReader.nextResult = "data:text/plain;base64,SGVsbG8=";
      vi.stubGlobal("FileReader", MockFileReader);

      const file = new File(["Hello"], "greeting.txt", {
        type: "text/plain",
        lastModified: 1700000000000,
      });

      await expect(readFileAsAttachment(file)).resolves.toEqual({
        id: "greeting.txt:1700000000000:5",
        filename: "greeting.txt",
        size: 5,
        contentType: "text/plain",
        contentBase64: "SGVsbG8=",
      });
    });

    it("falls back to application/octet-stream when the file has no type", async () => {
      MockFileReader.nextResult = "data:application/octet-stream;base64,QQ==";
      vi.stubGlobal("FileReader", MockFileReader);

      const file = new File(["A"], "raw.bin", {
        lastModified: 99,
      });

      await expect(readFileAsAttachment(file)).resolves.toMatchObject({
        id: "raw.bin:99:1",
        contentType: "application/octet-stream",
        contentBase64: "QQ==",
      });
    });
  });

  describe("resolveAiWarningMessage", () => {
    it("prefers grounding contradictions over every other warning", () => {
      expect(
        resolveAiWarningMessage({
          responseMode: null,
          warnings: [
            { code: "grounding_empty", message: "No grounding." },
            { code: "grounding_contradiction", message: "Project says no SMS." },
          ],
        }),
      ).toBe(
        "Your directive appears to contradict the project context. Project says no SMS.",
      );
    });

    it("uses the first warning in deterministic fallback mode", () => {
      expect(
        resolveAiWarningMessage({
          responseMode: "deterministic_fallback",
          warnings: [{ code: "misc_warning", message: "Fallback warning." }],
        }),
      ).toBe("Fallback warning.");
    });

    it("uses the deterministic fallback default message when no warnings exist", () => {
      expect(
        resolveAiWarningMessage({
          responseMode: "deterministic_fallback",
          warnings: [],
        }),
      ).toBe(
        "AI drafting returned a fallback skeleton. Fill in the project-specific answer before sending.",
      );
    });

    it("returns the grounding-empty warning when present outside fallback mode", () => {
      expect(
        resolveAiWarningMessage({
          responseMode: null,
          warnings: [{ code: "grounding_empty", message: "No grounded answer available." }],
        }),
      ).toBe("No grounded answer available.");
    });

    it("returns null when no relevant warning exists", () => {
      expect(
        resolveAiWarningMessage({
          responseMode: null,
          warnings: [{ code: "other", message: "Irrelevant." }],
        }),
      ).toBeNull();
    });
  });
});
