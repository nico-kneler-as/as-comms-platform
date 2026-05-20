/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as IntegrationsModule from "@as-comms/integrations";
import type { OpsAlertStateRepository } from "@as-comms/domain";

const sendGmailMessage = vi.hoisted(() => vi.fn());

vi.mock("@as-comms/integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof IntegrationsModule>();

  return {
    ...actual,
    sendGmailMessage,
  };
});

import { createOpsAlertSender } from "../src/ops-alert/sender.js";

function buildStateRepository(): OpsAlertStateRepository & {
  readonly getLastSentAt: ReturnType<typeof vi.fn>;
  readonly recordSent: ReturnType<typeof vi.fn>;
} {
  return {
    getLastSentAt: vi.fn().mockResolvedValue(null),
    recordSent: vi.fn().mockResolvedValue(undefined),
  };
}

function buildEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    GMAIL_LIVE_ACCOUNT: "volunteers@adventurescientists.org",
    GMAIL_GOOGLE_OAUTH_CLIENT_ID: "client-id",
    GMAIL_GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
    GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN: "refresh-token",
    ...overrides,
  };
}

describe("ops alert sender", () => {
  beforeEach(() => {
    sendGmailMessage.mockReset();
  });

  it("sends a generic ops alert, escapes HTML, and records sent state", async () => {
    sendGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-id",
      gmailThreadId: "gmail-thread-id",
      rfc822MessageId: "<alert@example.test>",
    });
    const stateRepository = buildStateRepository();
    const sender = createOpsAlertSender({
      env: buildEnv({
        OPS_ALERT_RECIPIENT: "ops@example.test",
        OPS_ALERT_FROM_ALIAS: "alerts@example.test",
      }),
      stateRepository,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    });

    const result = await sender.send({
      category: "worker_dead_letter",
      dedupKey: "job-123",
      severity: "s2",
      summary: "<script>alert(1)</script>",
      categoryLabel: "worker dead-letter",
      detail: [
        {
          label: "Job ID",
          value: "job-123",
        },
        {
          label: "Queue",
          value: "dead-letter",
        },
      ],
      links: [
        {
          label: "Dashboard",
          url: "https://comms.example.test/ops/dead-letter",
        },
      ],
      firstObservedAt: "2026-05-20T11:45:00.000Z",
      occurredAt: "2026-05-20T12:00:00.000Z",
    });

    expect(result).toEqual({
      kind: "sent",
      gmailMessageId: "gmail-message-id",
    });
    expect(sendGmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        fromAlias: "alerts@example.test",
        to: "ops@example.test",
        subject: "[AS Comms] worker dead-letter: <script>alert(1)</script>",
        bodyPlaintext: expect.stringContaining("Summary"),
        bodyHtml: expect.stringContaining(
          "&lt;script&gt;alert(1)&lt;/script&gt;",
        ),
        attachments: [],
      }),
      expect.any(Object),
    );
    expect(sendGmailMessage.mock.calls[0]?.[0].bodyPlaintext).toContain(
      "First observed at",
    );
    expect(sendGmailMessage.mock.calls[0]?.[0].bodyPlaintext).toContain(
      "Identifiers",
    );
    expect(sendGmailMessage.mock.calls[0]?.[0].bodyPlaintext).toContain(
      "Detail",
    );
    expect(sendGmailMessage.mock.calls[0]?.[0].bodyPlaintext).toContain(
      "Action links",
    );
    expect(sendGmailMessage.mock.calls[0]?.[0].bodyHtml).toContain("<dl>");
    expect(sendGmailMessage.mock.calls[0]?.[0].bodyHtml).toContain(
      '<a href="https://comms.example.test/ops/dead-letter">',
    );
    expect(sendGmailMessage.mock.calls[0]?.[0].bodyHtml).not.toContain(
      "<script>",
    );
    expect(stateRepository.recordSent).toHaveBeenCalledTimes(1);
    expect(stateRepository.recordSent).toHaveBeenCalledWith({
      category: "worker_dead_letter",
      dedupKey: "job-123",
      sentAt: "2026-05-20T12:00:00.000Z",
      status: "sent",
    });
  });

  it("skips send during cooldown without recording state", async () => {
    const stateRepository = buildStateRepository();
    stateRepository.getLastSentAt.mockResolvedValue({
      lastSentAt: "2026-05-20T11:30:00.000Z",
      lastStatus: "sent",
    });
    const sender = createOpsAlertSender({
      env: buildEnv(),
      stateRepository,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    });

    const result = await sender.send({
      category: "worker_dead_letter",
      dedupKey: "job-123",
      severity: "s2",
      summary: "Queue backed up",
      categoryLabel: "worker dead-letter",
      detail: [],
      links: [],
      firstObservedAt: "2026-05-20T11:45:00.000Z",
      occurredAt: "2026-05-20T12:00:00.000Z",
    });

    expect(result).toEqual({
      kind: "skipped_cooldown",
      lastSentAt: "2026-05-20T11:30:00.000Z",
    });
    expect(sendGmailMessage).not.toHaveBeenCalled();
    expect(stateRepository.recordSent).not.toHaveBeenCalled();
  });

  it("sends again after cooldown expiry", async () => {
    sendGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-id",
      gmailThreadId: "gmail-thread-id",
      rfc822MessageId: "<alert@example.test>",
    });
    const stateRepository = buildStateRepository();
    stateRepository.getLastSentAt.mockResolvedValue({
      lastSentAt: "2026-05-20T10:00:00.000Z",
      lastStatus: "sent",
    });
    const sender = createOpsAlertSender({
      env: buildEnv(),
      stateRepository,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    });

    const result = await sender.send({
      category: "worker_dead_letter",
      dedupKey: "job-123",
      severity: "s2",
      summary: "Queue backed up",
      categoryLabel: "worker dead-letter",
      detail: [],
      links: [],
      firstObservedAt: "2026-05-20T11:45:00.000Z",
      occurredAt: "2026-05-20T12:00:00.000Z",
    });

    expect(result).toEqual({
      kind: "sent",
      gmailMessageId: "gmail-message-id",
    });
    expect(sendGmailMessage).toHaveBeenCalledTimes(1);
    expect(stateRepository.recordSent).toHaveBeenCalledTimes(1);
  });

  it("respects a per-category cooldown override", async () => {
    const stateRepository = buildStateRepository();
    stateRepository.getLastSentAt.mockResolvedValue({
      lastSentAt: "2026-05-20T11:58:30.000Z",
      lastStatus: "sent",
    });
    const sender = createOpsAlertSender({
      env: buildEnv({
        OPS_ALERT_COOLDOWN_MS__WORKER_DEAD_LETTER: "120000",
      }),
      stateRepository,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    });

    const result = await sender.send({
      category: "worker_dead_letter",
      dedupKey: "job-123",
      severity: "s2",
      summary: "Queue backed up",
      categoryLabel: "worker dead-letter",
      detail: [],
      links: [],
      firstObservedAt: "2026-05-20T11:45:00.000Z",
      occurredAt: "2026-05-20T12:00:00.000Z",
    });

    expect(result).toEqual({
      kind: "skipped_cooldown",
      lastSentAt: "2026-05-20T11:58:30.000Z",
    });
    expect(sendGmailMessage).not.toHaveBeenCalled();
  });

  it("returns auth_error when Gmail credentials are missing", async () => {
    const stateRepository = buildStateRepository();
    const sender = createOpsAlertSender({
      env: {},
      stateRepository,
    });

    const result = await sender.send({
      category: "worker_dead_letter",
      dedupKey: "job-123",
      severity: "s2",
      summary: "Queue backed up",
      categoryLabel: "worker dead-letter",
      detail: [],
      links: [],
      firstObservedAt: "2026-05-20T11:45:00.000Z",
      occurredAt: "2026-05-20T12:00:00.000Z",
    });

    expect(result).toEqual({
      kind: "auth_error",
      detail: "Ops alert email is not configured.",
    });
    expect(sendGmailMessage).not.toHaveBeenCalled();
    expect(stateRepository.recordSent).not.toHaveBeenCalled();
  });

  it("returns transport_error when Gmail send fails", async () => {
    sendGmailMessage.mockResolvedValue({
      kind: "transient",
      detail: "Gmail send request failed.",
    });
    const stateRepository = buildStateRepository();
    const sender = createOpsAlertSender({
      env: buildEnv(),
      stateRepository,
    });

    const result = await sender.send({
      category: "worker_dead_letter",
      dedupKey: "job-123",
      severity: "s2",
      summary: "Queue backed up",
      categoryLabel: "worker dead-letter",
      detail: [],
      links: [],
      firstObservedAt: "2026-05-20T11:45:00.000Z",
      occurredAt: "2026-05-20T12:00:00.000Z",
    });

    expect(result).toEqual({
      kind: "transport_error",
      detail: "Gmail send request failed.",
    });
    expect(stateRepository.recordSent).not.toHaveBeenCalled();
  });

  it("applies recipient precedence for generic categories", async () => {
    sendGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-id",
      gmailThreadId: "gmail-thread-id",
      rfc822MessageId: "<alert@example.test>",
    });
    const senderWithDefault = createOpsAlertSender({
      env: buildEnv(),
      stateRepository: buildStateRepository(),
    });

    await senderWithDefault.send({
      category: "worker_dead_letter",
      dedupKey: "job-123",
      severity: "s2",
      summary: "Queue backed up",
      categoryLabel: "worker dead-letter",
      detail: [],
      links: [],
      firstObservedAt: "2026-05-20T11:45:00.000Z",
      occurredAt: "2026-05-20T12:00:00.000Z",
    });

    expect(sendGmailMessage.mock.calls[0]?.[0].to).toBe(
      "nico@adventurescientists.org",
    );

    sendGmailMessage.mockClear();

    const senderWithOverride = createOpsAlertSender({
      env: buildEnv({
        OPS_ALERT_RECIPIENT: "ops@example.test",
      }),
      stateRepository: buildStateRepository(),
    });

    await senderWithOverride.send({
      category: "worker_dead_letter",
      dedupKey: "job-456",
      severity: "s2",
      summary: "Queue backed up",
      categoryLabel: "worker dead-letter",
      detail: [],
      links: [],
      firstObservedAt: "2026-05-20T11:45:00.000Z",
      occurredAt: "2026-05-20T12:00:00.000Z",
    });

    expect(sendGmailMessage.mock.calls[0]?.[0].to).toBe("ops@example.test");
  });

  it("truncates long subjects to 120 characters with an ellipsis", async () => {
    sendGmailMessage.mockResolvedValue({
      kind: "success",
      gmailMessageId: "gmail-message-id",
      gmailThreadId: "gmail-thread-id",
      rfc822MessageId: "<alert@example.test>",
    });
    const sender = createOpsAlertSender({
      env: buildEnv(),
      stateRepository: buildStateRepository(),
    });

    await sender.send({
      category: "worker_dead_letter",
      dedupKey: "job-123",
      severity: "s2",
      summary: "x".repeat(200),
      categoryLabel: "worker dead-letter",
      detail: [],
      links: [],
      firstObservedAt: "2026-05-20T11:45:00.000Z",
      occurredAt: "2026-05-20T12:00:00.000Z",
    });

    const subject = sendGmailMessage.mock.calls[0]?.[0].subject as string;

    expect(subject.length).toBeLessThanOrEqual(120);
    expect(subject.endsWith("…")).toBe(true);
  });
});
