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
import { getStage1WebRuntime } from "../../src/server/stage1-runtime";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function buildCurrentUser(input?: {
  readonly role?: "operator" | "admin";
  readonly name?: string | null;
}) {
  const now = new Date("2026-04-21T12:00:00.000Z");
  return {
    id: "user:operator",
    name: input?.name === undefined ? "Operator" : input.name,
    email: "operator@example.org",
    emailVerified: now,
    image: null,
    role: input?.role ?? "operator",
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

async function installSqlSpy() {
  const runtime = await getStage1WebRuntime();
  const sqlSpy = vi.fn(() => Promise.resolve([]));
  if ((runtime as { connection: unknown }).connection !== null) {
    (runtime as { connection: { sql: unknown } }).connection.sql = sqlSpy;
  }
  return sqlSpy;
}

async function seedApprovedKnowledgeEntries(input: {
  readonly runtime: Stage1WebTestRuntime;
  readonly projectId: string;
  readonly count: number;
  readonly baseTimestamp?: string;
}): Promise<void> {
  const baseTimestamp = input.baseTimestamp ?? "2026-04-21T11:00:00.000Z";
  for (let index = 0; index < input.count; index += 1) {
    const minuteOffset = String(index).padStart(2, "0");
    const isoTimestamp = `2026-04-21T11:${minuteOffset}:00.000Z`;
    await input.runtime.context.repositories.projectKnowledge.upsert({
      id: `project_knowledge:seed:${String(index)}`,
      projectId: input.projectId,
      kind: "canonical_reply",
      issueType: null,
      volunteerStage: null,
      questionSummary: `Seeded approval ${String(index)}`,
      replyStrategy: null,
      maskedExample: `Seeded approved reply body ${String(index)}.`,
      sourceKind: "captured_from_send",
      approvedForAi: true,
      sourceEventId: null,
      metadataJson: { seedIndex: index },
      lastReviewedAt: null,
      createdAt: isoTimestamp,
      updatedAt: isoTimestamp,
    });
  }
  // Reference baseTimestamp so a future regression where it's relied upon
  // surfaces via lint, not silently.
  void baseTimestamp;
}

async function seedEnabledNotionSource(input: {
  readonly runtime: Stage1WebTestRuntime;
  readonly projectId: string;
}): Promise<void> {
  await input.runtime.context.repositories.projectDimensions.setAiKnowledgeSources(
    input.projectId,
    [
      {
        id: "11111111-1111-4111-8111-111111111111",
        url: "https://www.notion.so/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        kind: "notion",
        label: "Antarctica AI Knowledge",
        enabled: true,
        last_synced_at: null,
        last_sync_status: "pending",
        last_sync_error: null,
        source_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        source_content_hash: null,
        created_at: "2026-04-21T10:00:00.000Z",
        updated_at: "2026-04-21T10:00:00.000Z",
      },
    ],
  );
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
      expect.objectContaining({ resolveThreadIdViaRfc822: true }),
    );
    expect(markSentRfc822Spy).toHaveBeenCalledWith(
      result.data.pendingOutboundId,
      "<gmail-message-1@example.org>",
    );
  });

  it("passes cc and bcc arrays through to the Gmail send client", async () => {
    sendComposerGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-2",
      gmailThreadId: "gmail-thread-2",
      rfc822MessageId: "<gmail-message-2@example.org>",
    });

    const result = await sendComposerAction({
      ...buildInput({
        recipient: {
          kind: "contact",
          contactId: "contact:existing",
        },
      }),
      cc: ["partner@example.org"],
      bcc: ["archive@example.org"],
    });

    expect(result.ok).toBe(true);
    expect(sendComposerGmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        cc: ["partner@example.org"],
        bcc: ["archive@example.org"],
      }),
      expect.objectContaining({ resolveThreadIdViaRfc822: true }),
    );
  });

  it("resolves the operator first-name signature token in both plaintext and HTML", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    requireSession.mockResolvedValueOnce(
      buildCurrentUser({ name: "Nico Kneler" }),
    );
    await runtime.context.settings.aliases.updateSignature({
      aliasId: "alias:antarctica",
      signature: "Best,\n{{operatorFirstName}}\nAdventure Scientists",
      actorId: "user:operator",
    });
    sendComposerGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-signature",
      gmailThreadId: "gmail-thread-signature",
      rfc822MessageId: "<gmail-message-signature@example.org>",
    });

    const result = await sendComposerAction(buildInput());

    expect(result.ok).toBe(true);
    expect(sendComposerGmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyPlaintext:
          "Thanks again for confirming the field logistics.\n\nBest,\nNico\nAdventure Scientists",
        bodyHtml:
          "<p>Thanks again for confirming the field logistics.</p><p>Best,<br>Nico<br>Adventure Scientists</p>",
      }),
      expect.objectContaining({ resolveThreadIdViaRfc822: true }),
    );

    if (!result.ok) {
      throw new Error("Expected success result.");
    }

    const pendingRows =
      await runtime.context.repositories.pendingOutbounds.findForContact(
        result.data.canonicalContactId,
        { limit: 10 },
      );

    expect(pendingRows[0]).toMatchObject({
      bodyPlaintext:
        "Thanks again for confirming the field logistics.\n\nBest,\nNico\nAdventure Scientists",
      bodyHtml:
        "<p>Thanks again for confirming the field logistics.</p><p>Best,<br>Nico<br>Adventure Scientists</p>",
    });
  });

  it("uses signatureOverride instead of the alias default in both plaintext and HTML", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    requireSession.mockResolvedValueOnce(
      buildCurrentUser({ name: "Nico Kneler" }),
    );
    await runtime.context.settings.aliases.updateSignature({
      aliasId: "alias:antarctica",
      signature: "Best,\nProject Antarctica",
      actorId: "user:operator",
    });
    sendComposerGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-override",
      gmailThreadId: "gmail-thread-override",
      rfc822MessageId: "<gmail-message-override@example.org>",
    });

    const result = await sendComposerAction(
      buildInput({
        signatureOverride: "Warmly,\n{{operatorFirstName}}\nCustom Reply",
      }),
    );

    expect(result.ok).toBe(true);
    expect(sendComposerGmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyPlaintext:
          "Thanks again for confirming the field logistics.\n\nWarmly,\nNico\nCustom Reply",
        bodyHtml:
          "<p>Thanks again for confirming the field logistics.</p><p>Warmly,<br>Nico<br>Custom Reply</p>",
      }),
      expect.objectContaining({ resolveThreadIdViaRfc822: true }),
    );

    if (!result.ok) {
      throw new Error("Expected success result.");
    }

    const pendingRows =
      await runtime.context.repositories.pendingOutbounds.findForContact(
        result.data.canonicalContactId,
        { limit: 10 },
      );

    expect(pendingRows[0]).toMatchObject({
      bodyPlaintext:
        "Thanks again for confirming the field logistics.\n\nWarmly,\nNico\nCustom Reply",
      bodyHtml:
        "<p>Thanks again for confirming the field logistics.</p><p>Warmly,<br>Nico<br>Custom Reply</p>",
    });
  });

  it("drops empty operator token lines when the operator has no name", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    requireSession.mockResolvedValueOnce(buildCurrentUser({ name: null }));
    await runtime.context.settings.aliases.updateSignature({
      aliasId: "alias:antarctica",
      signature: "Best,\n{{operatorFirstName}}\nAdventure Scientists",
      actorId: "user:operator",
    });
    sendComposerGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-no-name",
      gmailThreadId: "gmail-thread-no-name",
      rfc822MessageId: "<gmail-message-no-name@example.org>",
    });

    const result = await sendComposerAction(buildInput());

    expect(result.ok).toBe(true);
    expect(sendComposerGmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyPlaintext:
          "Thanks again for confirming the field logistics.\n\nBest,\nAdventure Scientists",
        bodyHtml:
          "<p>Thanks again for confirming the field logistics.</p><p>Best,<br>Adventure Scientists</p>",
      }),
      expect.objectContaining({ resolveThreadIdViaRfc822: true }),
    );

    if (!result.ok) {
      throw new Error("Expected success result.");
    }

    const pendingRows =
      await runtime.context.repositories.pendingOutbounds.findForContact(
        result.data.canonicalContactId,
        { limit: 10 },
      );

    expect(pendingRows[0]).toMatchObject({
      bodyPlaintext:
        "Thanks again for confirming the field logistics.\n\nBest,\nAdventure Scientists",
      bodyHtml:
        "<p>Thanks again for confirming the field logistics.</p><p>Best,<br>Adventure Scientists</p>",
    });
  });

  it("does not create a project knowledge entry when saveAsKnowledge is false", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    sendComposerGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-no-knowledge",
      gmailThreadId: "gmail-thread-no-knowledge",
      rfc822MessageId: "<gmail-message-no-knowledge@example.org>",
    });

    const result = await sendComposerAction({
      ...buildInput(),
      saveAsKnowledge: false,
    });

    expect(result.ok).toBe(true);
    await expect(
      runtime.context.repositories.projectKnowledge.list({
        projectId: "project:antarctica",
      }),
    ).resolves.toEqual([]);
  });

  it("creates an approved-for-AI project knowledge entry when saveAsKnowledge is true", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    sendComposerGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-knowledge",
      gmailThreadId: "gmail-thread-knowledge",
      rfc822MessageId: "<gmail-message-knowledge@example.org>",
    });

    const result = await sendComposerAction({
      ...buildInput(),
      saveAsKnowledge: true,
    });

    expect(result.ok).toBe(true);

    const entries = await runtime.context.repositories.projectKnowledge.list({
      projectId: "project:antarctica",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "canonical_reply",
      sourceKind: "captured_from_send",
      // Phase 3 of PRD #366: the operator's "Send and save for AI" click
      // IS the approval signal. Captures land approved-for-AI immediately.
      approvedForAi: true,
      questionSummary: "Field logistics",
      maskedExample: "Thanks again for confirming the field logistics.",
    });
    expect(entries[0]?.metadataJson).toMatchObject({
      subject: "Field logistics",
      bodyPlaintext: "Thanks again for confirming the field logistics.",
      createdByUserId: "user:operator",
      gmailMessageId: "gmail-message-knowledge",
      gmailThreadId: "gmail-thread-knowledge",
      rfc822MessageId: "<gmail-message-knowledge@example.org>",
    });
  });

  it("does not create a project knowledge entry when the send fails", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    sendComposerGmailMessage.mockResolvedValue({
      kind: "permanent",
      detail: "Gmail rejected the send request.",
    });

    const result = await sendComposerAction({
      ...buildInput(),
      saveAsKnowledge: true,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "send_failed",
    });
    await expect(
      runtime.context.repositories.projectKnowledge.list({
        projectId: "project:antarctica",
      }),
    ).resolves.toEqual([]);
  });

  it("does not enqueue synthesis when the capture count remains below the threshold", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    await seedEnabledNotionSource({
      runtime,
      projectId: "project:antarctica",
    });
    // Pre-seed 3 approved replies; one new send brings the post-capture
    // total to 4 — still under the threshold of 5.
    await seedApprovedKnowledgeEntries({
      runtime,
      projectId: "project:antarctica",
      count: 3,
    });

    const sqlSpy = await installSqlSpy();
    sendComposerGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-below-threshold",
      gmailThreadId: "gmail-thread-below-threshold",
      rfc822MessageId: "<gmail-message-below-threshold@example.org>",
    });

    const result = await sendComposerAction({
      ...buildInput({ subject: "Below threshold" }),
      saveAsKnowledge: true,
    });

    expect(result.ok).toBe(true);
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it("enqueues a single synthesis job once the capture threshold is reached and re-enqueues with replace mode on subsequent captures", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    await seedEnabledNotionSource({
      runtime,
      projectId: "project:antarctica",
    });
    // Pre-seed 4 approved replies — the 5th capture below trips the threshold.
    await seedApprovedKnowledgeEntries({
      runtime,
      projectId: "project:antarctica",
      count: 4,
    });

    const sqlSpy = await installSqlSpy();
    sendComposerGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-trigger",
      gmailThreadId: "gmail-thread-trigger",
      rfc822MessageId: "<gmail-message-trigger@example.org>",
    });

    const fifthResult = await sendComposerAction({
      ...buildInput({ subject: "Trigger fifth capture" }),
      saveAsKnowledge: true,
    });

    expect(fifthResult.ok).toBe(true);
    expect(sqlSpy).toHaveBeenCalledTimes(1);

    const firstCallArgs = sqlSpy.mock.calls[0] as readonly unknown[] | undefined;
    const firstStrings = firstCallArgs?.[0] as readonly string[] | undefined;
    const firstSqlTemplate = firstStrings?.join("|") ?? "";
    // The tagged template structure is fixed by enqueueSynthesizeProjectKnowledgeJob.
    // We assert on the literal pieces to lock in graphile add_job semantics.
    expect(firstSqlTemplate).toContain("graphile_worker.add_job");
    expect(firstSqlTemplate).toContain("identifier =>");
    expect(firstSqlTemplate).toContain("job_key_mode => 'replace'");

    const firstParams = firstCallArgs?.slice(1) ?? [];
    expect(firstParams).toContain("synthesize-project-knowledge");
    const firstJobKey = firstParams.find(
      (param): param is string =>
        typeof param === "string" &&
        param.startsWith("ai-knowledge-capture-trigger:"),
    );
    expect(firstJobKey).toBe("ai-knowledge-capture-trigger:project:antarctica");
    const firstPayload = firstParams.find(
      (param): param is string =>
        typeof param === "string" && param.startsWith("{"),
    );
    expect(firstPayload).toBeDefined();
    if (firstPayload === undefined) {
      throw new Error("Expected enqueue payload to be a JSON string.");
    }
    const parsedPayload = JSON.parse(firstPayload) as {
      readonly skipIfHashUnchanged?: boolean;
    };
    expect(parsedPayload.skipIfHashUnchanged).toBe(false);

    sqlSpy.mockClear();
    sendComposerGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-trigger-2",
      gmailThreadId: "gmail-thread-trigger-2",
      rfc822MessageId: "<gmail-message-trigger-2@example.org>",
    });

    const sixthResult = await sendComposerAction({
      ...buildInput({ subject: "Sixth capture re-enqueues" }),
      saveAsKnowledge: true,
    });

    expect(sixthResult.ok).toBe(true);
    // Each capture above threshold replays the enqueue with the same job
    // key — graphile's job_key_mode=replace dedupes idle pending jobs.
    expect(sqlSpy).toHaveBeenCalledTimes(1);
  });

  it("does not enqueue synthesis when the project has no enabled AI knowledge sources", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    // Threshold is reached, but no enabled source registered → no synthesis.
    await seedApprovedKnowledgeEntries({
      runtime,
      projectId: "project:antarctica",
      count: 4,
    });

    const sqlSpy = await installSqlSpy();
    sendComposerGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-no-sources",
      gmailThreadId: "gmail-thread-no-sources",
      rfc822MessageId: "<gmail-message-no-sources@example.org>",
    });

    const result = await sendComposerAction({
      ...buildInput({ subject: "No sources registered" }),
      saveAsKnowledge: true,
    });

    expect(result.ok).toBe(true);
    expect(sqlSpy).not.toHaveBeenCalled();
  });

  it("keeps the capture successful even when the synthesis enqueue throws", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    await seedEnabledNotionSource({
      runtime,
      projectId: "project:antarctica",
    });
    await seedApprovedKnowledgeEntries({
      runtime,
      projectId: "project:antarctica",
      count: 4,
    });

    const runtimeForSpy = await getStage1WebRuntime();
    const failingSql = vi.fn(() => {
      throw new Error("graphile_worker.add_job is unavailable.");
    });
    if ((runtimeForSpy as { connection: unknown }).connection !== null) {
      (runtimeForSpy as { connection: { sql: unknown } }).connection.sql =
        failingSql;
    }

    sendComposerGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-enqueue-fail",
      gmailThreadId: "gmail-thread-enqueue-fail",
      rfc822MessageId: "<gmail-message-enqueue-fail@example.org>",
    });
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const result = await sendComposerAction({
      ...buildInput({ subject: "Enqueue failure does not block capture" }),
      saveAsKnowledge: true,
    });

    expect(result.ok).toBe(true);
    expect(failingSql).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "Capture-triggered AI knowledge synthesis enqueue failed; capture itself succeeded.",
      expect.objectContaining({ projectId: "project:antarctica" }),
    );
    warnSpy.mockRestore();

    const entries = await runtime.context.repositories.projectKnowledge.list({
      projectId: "project:antarctica",
    });
    // 4 seeded + 1 new capture = 5 rows persisted (the capture itself succeeded).
    expect(entries.length).toBe(5);
  });

  it("maps ambiguous net-new recipient emails to invalid_recipient", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    const now = new Date("2026-04-21T12:05:00.000Z").toISOString();
    await runtime.context.repositories.contacts.upsert({
      id: "contact:duplicate",
      salesforceContactId: null,
      displayName: "Duplicate Contact",
      primaryEmail: "existing@example.org",
      primaryPhone: null,
      createdAt: now,
      updatedAt: now,
    });
    await runtime.context.repositories.contactIdentities.upsert({
      id: "identity:duplicate:email",
      contactId: "contact:duplicate",
      kind: "email",
      normalizedValue: "existing@example.org",
      isPrimary: true,
      source: "manual",
      verifiedAt: now,
    });

    const result = await sendComposerAction(
      buildInput({
        recipient: {
          kind: "email",
          emailAddress: "existing@example.org",
        },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_recipient",
      retryable: false,
    });
    expect(sendComposerGmailMessage).not.toHaveBeenCalled();
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
      attemptedAt: "2026-04-21T11:00:00.000Z",
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
