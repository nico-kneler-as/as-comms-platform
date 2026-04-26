import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.hoisted(() => vi.fn());
const sendComposerGmailMessage = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
}));

vi.mock("@/src/server/auth/session", () => ({
  requireSession,
}));

vi.mock("@/src/server/composer/gmail-send", () => ({
  sendComposerGmailMessage,
}));

import {
  sendComposerAction,
  type ComposerSendActionInput,
} from "../../app/inbox/actions";
import { resetSecurityRateLimiterForTests } from "../../src/server/security/rate-limit";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function buildCurrentUser(role: "operator" | "admin" = "operator") {
  const now = new Date("2026-04-21T12:00:00.000Z");
  return {
    id: "user:operator",
    name: "Operator",
    email: "operator@example.org",
    emailVerified: now,
    image: null,
    role,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function seedComposerFixture(runtime: Stage1WebTestRuntime): Promise<void> {
  const now = new Date("2026-04-21T12:00:00.000Z");
  const user = buildCurrentUser();

  await runtime.context.settings.users.upsert(user);
  await runtime.context.repositories.projectDimensions.upsert({
    projectId: "project:antarctica",
    projectName: "Project Antarctica",
    source: "salesforce",
  });
  await runtime.context.settings.aliases.create({
    id: "alias:antarctica",
    alias: "antarctica@example.org",
    signature: "",
    projectId: "project:antarctica",
    createdAt: now,
    updatedAt: now,
    createdBy: user.id,
    updatedBy: user.id,
  });
  await runtime.context.repositories.contacts.upsert({
    id: "contact:existing",
    salesforceContactId: null,
    displayName: "Existing Contact",
    primaryEmail: "existing@example.org",
    primaryPhone: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  await runtime.context.repositories.contactIdentities.upsert({
    id: "identity:existing:email",
    contactId: "contact:existing",
    kind: "email",
    normalizedValue: "existing@example.org",
    isPrimary: true,
    source: "manual",
    verifiedAt: now.toISOString(),
  });
}

function buildInput(
  overrides?: Partial<ComposerSendActionInput>
): ComposerSendActionInput {
  return {
    recipient: {
      kind: "email",
      emailAddress: "new-volunteer@example.org",
    },
    alias: "antarctica@example.org",
    subject: "Field logistics",
    bodyPlaintext: "Thanks again for confirming the field logistics.",
    bodyHtml: "<p>Thanks again for confirming the field logistics.</p>",
    attachments: [
      {
        filename: "checklist.txt",
        contentType: "text/plain",
        contentBase64: Buffer.from("checklist", "utf8").toString("base64"),
      },
    ],
    ...overrides,
  };
}

describe("sendComposerAction", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    requireSession.mockReset();
    sendComposerGmailMessage.mockReset();
    resetSecurityRateLimiterForTests();
    requireSession.mockResolvedValue(buildCurrentUser());
    runtime = await createStage1WebTestRuntime();
    await seedComposerFixture(runtime);
  });

  afterEach(async () => {
    resetSecurityRateLimiterForTests();
    await runtime?.dispose();
    runtime = null;
  });

  it("writes a durable pending row first, creates a contact for a naked email, and returns the FP-07 success envelope", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    const markSentRfc822Spy = vi.spyOn(
      runtime.context.repositories.pendingOutbounds,
      "markSentRfc822",
    );
    sendComposerGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-1",
      gmailThreadId: "gmail-thread-1",
      rfc822MessageId: "<gmail-message-1@example.org>",
    });

    const result = await sendComposerAction(buildInput());

    expect(result).toMatchObject({
      ok: true,
      data: {
        threadId: "gmail-thread-1",
      },
    });

    if (!result.ok) {
      throw new Error("Expected success result.");
    }

    const contact = await runtime.context.repositories.contacts.findById(
      result.data.canonicalContactId
    );
    const pendingRows = await runtime.context.repositories.pendingOutbounds.findForContact(
      result.data.canonicalContactId,
      { limit: 10 }
    );
    const audits = await runtime.context.repositories.auditEvidence.listByEntity({
      entityType: "pending_composer_outbound",
      entityId: result.data.pendingOutboundId,
    });

    expect(contact).toMatchObject({
      id: "contact:email:new-volunteer@example.org",
      primaryEmail: "new-volunteer@example.org",
    });
    expect(pendingRows[0]).toMatchObject({
      id: result.data.pendingOutboundId,
      // PR #143 immediately confirms on successful Gmail send instead of waiting
      // for inbound reconciliation to fire (which never fires for internal sends).
      status: "confirmed",
      fromAlias: "antarctica@example.org",
      toEmailNormalized: "new-volunteer@example.org",
      subject: "Field logistics",
      bodyHtml: "<p>Thanks again for confirming the field logistics.</p>",
      attachmentMetadata: [
        {
          filename: "checklist.txt",
          size: 9,
          contentType: "text/plain",
        },
      ],
      sentRfc822MessageId: "<gmail-message-1@example.org>",
    });
    expect(audits.map((audit) => audit.action)).toEqual([
      "composer.send_attempted",
      "composer.send_succeeded",
    ]);
    expect(sendComposerGmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyPlaintext: "Thanks again for confirming the field logistics.",
        bodyHtml: "<p>Thanks again for confirming the field logistics.</p>",
      }),
    );
    expect(markSentRfc822Spy).toHaveBeenCalledWith(
      result.data.pendingOutboundId,
      "<gmail-message-1@example.org>",
    );
  });

  it("maps all typed Gmail send errors into the FP-07 envelope and marks the row failed", async () => {
    const cases = [
      ["auth_error", "composer_unavailable", false],
      ["scope_error", "composer_unavailable", false],
      ["send_as_not_authorized", "alias_not_authorized", false],
      ["invalid_recipient", "invalid_recipient", false],
      ["attachment_too_large", "attachment_too_large", false],
      ["rate_limited", "provider_rate_limited", true],
      ["transient", "provider_transient", true],
      ["permanent", "send_failed", false],
    ] as const;

    for (const [kind, code, retryable] of cases) {
      sendComposerGmailMessage.mockResolvedValueOnce(
        kind === "send_as_not_authorized"
          ? { kind, alias: "antarctica@example.org" }
          : kind === "attachment_too_large"
            ? { kind, totalBytes: 25 * 1024 * 1024 }
            : kind === "rate_limited"
              ? { kind, retryAfterSeconds: 30 }
              : { kind, detail: `${kind} detail` }
      );

      const result = await sendComposerAction({
        ...buildInput(),
        recipient: {
          kind: "contact",
          contactId: "contact:existing",
        },
        subject: `Field logistics ${kind}`,
      });

      expect(result).toMatchObject({
        ok: false,
        code,
        retryable,
      });

      if (!runtime) {
        throw new Error("Expected runtime.");
      }

      const pendingRows =
        await runtime.context.repositories.pendingOutbounds.findForContact(
          "contact:existing",
          { limit: 20 }
        );
      const matchingRow = pendingRows.find(
        (row) => row.subject === `Field logistics ${kind}`
      );

      expect(matchingRow).toMatchObject({
        status: "failed",
        failedReason: kind,
      });
    }
  });

  it("rejects unauthorized callers and rate limits after 30 sends per minute", async () => {
    requireSession.mockRejectedValueOnce(new Error("UNAUTHORIZED"));

    const unauthorized = await sendComposerAction(buildInput());

    expect(unauthorized).toMatchObject({
      ok: false,
      code: "unauthorized",
    });

    requireSession.mockResolvedValue(buildCurrentUser());
    sendComposerGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-rate",
      gmailThreadId: "gmail-thread-rate",
      rfc822MessageId: "<gmail-message-rate@example.org>",
    });

    for (let index = 0; index < 30; index += 1) {
      const result = await sendComposerAction({
        ...buildInput(),
        subject: `Rate limit ${String(index)}`,
      });
      expect(result.ok).toBe(true);
    }

    const limited = await sendComposerAction({
      ...buildInput(),
      subject: "Rate limit blocked",
    });

    expect(limited).toMatchObject({
      ok: false,
      code: "rate_limit_exceeded",
      retryable: true,
    });
    expect(sendComposerGmailMessage).toHaveBeenCalledTimes(30);
  });

  it("marks the superseded row only after the new send succeeds", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    await runtime.context.repositories.pendingOutbounds.insert({
      id: "pending:old",
      fingerprint: "fp:old",
      actorId: "user:operator",
      canonicalContactId: "contact:existing",
      projectId: "project:antarctica",
      fromAlias: "antarctica@example.org",
      toEmailNormalized: "existing@example.org",
      subject: "Old failed send",
      bodyPlaintext: "Old body",
      bodyHtml: "<p>Old body</p>",
      bodySha256: "sha256:old",
      attachmentMetadata: [],
      gmailThreadId: null,
      inReplyToRfc822: null,
      sentAt: "2026-04-21T11:00:00.000Z",
    });
    await runtime.context.repositories.pendingOutbounds.markFailed("pending:old", {
      reason: "permanent",
    });
    sendComposerGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-2",
      gmailThreadId: "gmail-thread-2",
      rfc822MessageId: "<gmail-message-2@example.org>",
    });

    const result = await sendComposerAction({
      ...buildInput(),
      recipient: {
        kind: "contact",
        contactId: "contact:existing",
      },
      supersedesPendingId: "pending:old",
      subject: "Replacement send",
    });

    expect(result.ok).toBe(true);

    const oldRow =
      await runtime.context.repositories.pendingOutbounds.findByFingerprint("fp:old");
    const visibleRows = await runtime.context.repositories.pendingOutbounds.findForContact(
      "contact:existing",
      { limit: 10 }
    );

    expect(oldRow).toMatchObject({
      id: "pending:old",
      status: "superseded",
    });
    expect(visibleRows.map((row) => row.subject)).toContain("Replacement send");
  });
});
