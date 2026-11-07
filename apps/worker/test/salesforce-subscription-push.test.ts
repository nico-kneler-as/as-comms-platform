import { describe, expect, it, vi } from "vitest";

import type {
  SalesforceSubscriptionOutboxRepository,
} from "@as-comms/db";
import { SalesforceWriteError } from "@as-comms/integrations";

import { createSalesforceSubscriptionPushTask } from "../src/jobs/salesforce-subscription-push.js";

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    email: "person@example.org",
    contactId: null,
    eventKind: "newsletter_signup" as const,
    projectId: null,
    occurredAt: "2026-01-01T00:00:00.000Z",
    status: "pending" as const,
    attempts: 0,
    nextAttemptAt: "2026-01-01T00:00:00.000Z",
    lastErrorKind: null,
    lastErrorCode: null,
    sentAt: null,
    claimedAt: "2026-02-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function harness(rows = [outboxRow()]) {
  const transitions: string[] = [];
  const markSent = vi.fn(() => {
    transitions.push("sent");
    return Promise.resolve(1);
  });
  const markTransient = vi.fn(() => {
    transitions.push("transient");
    return Promise.resolve({ retried: 1, parked: 0 });
  });
  const markParked = vi.fn().mockResolvedValue(1);
  const deferPermission = vi.fn().mockResolvedValue(1);
  const outbox = {
    claimPending: vi.fn().mockResolvedValue(rows),
    markSent,
    markTransient,
    markParked,
    deferPermission,
    countByStatus: vi.fn().mockResolvedValue({ pending: 0, parked: 0 }),
    listProjectHosts: vi.fn().mockResolvedValue(new Map()),
    listSalesforceContactIds: vi.fn().mockResolvedValue(new Map()),
  } as unknown as SalesforceSubscriptionOutboxRepository;
  const writeClient = { upsertSubscriptionPreferences: vi.fn() };
  const sendAlert = vi.fn().mockResolvedValue({ kind: "sent", gmailMessageId: "1" });
  const opsAlertSender = { send: sendAlert };
  const logInfo = vi.fn();
  const logError = vi.fn();
  const logger = { info: logInfo, error: logError };
  const task = createSalesforceSubscriptionPushTask({
    outbox,
    projectDimensions: {
      listProjectSubscriptionBoxes: vi.fn().mockResolvedValue(new Map()),
    },
    writeClient,
    opsAlertSender,
    logger,
    now: () => new Date("2026-02-01T00:00:00.000Z"),
  });
  return {
    task,
    writeClient,
    markSent,
    markTransient,
    markParked,
    deferPermission,
    sendAlert,
    logInfo,
    logError,
    transitions,
  };
}

describe("salesforce-subscription-push task", () => {
  it("marks successful rows sent", async () => {
    const h = harness();
    h.writeClient.upsertSubscriptionPreferences.mockResolvedValue([{
      email: "person@example.org",
      outcome: "created",
      salesforceId: "a01",
      error: null,
    }]);
    await h.task({}, {} as never);
    expect(h.markSent).toHaveBeenCalledOnce();
    expect(h.logInfo).toHaveBeenCalledWith(expect.stringContaining('"created":1'));
  });

  it("retries transient failures and parks permanent failures", async () => {
    const transient = harness();
    transient.writeClient.upsertSubscriptionPreferences.mockResolvedValue([{
      email: "person@example.org",
      outcome: "failed",
      salesforceId: null,
      error: { kind: "transient", code: "UNABLE_TO_LOCK_ROW", message: "hidden" },
    }]);
    await transient.task({}, {} as never);
    expect(transient.markTransient).toHaveBeenCalledWith(
      expect.any(Array),
      new Date("2026-02-01T00:00:00.000Z"),
      "UNABLE_TO_LOCK_ROW",
    );

    const permanent = harness();
    permanent.writeClient.upsertSubscriptionPreferences.mockResolvedValue([{
      email: "person@example.org",
      outcome: "failed",
      salesforceId: null,
      error: { kind: "permanent", code: "INVALID_EMAIL", message: "hidden" },
    }]);
    await permanent.task({}, {} as never);
    expect(permanent.markParked).toHaveBeenCalledWith(
      expect.any(Array),
      "permanent",
      "INVALID_EMAIL",
    );
  });

  it("defers permission failures without the transient-attempt path and alerts with a stable key", async () => {
    const h = harness();
    h.writeClient.upsertSubscriptionPreferences.mockRejectedValue(
      new SalesforceWriteError("secret message", "permission", 403, "DENIED"),
    );
    await h.task({}, {} as never);
    expect(h.deferPermission).toHaveBeenCalledOnce();
    expect(h.markTransient).not.toHaveBeenCalled();
    expect(h.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: "salesforce-subscription-push-permission" }),
    );
    expect(h.logError).toHaveBeenCalledWith(
      '{"event":"salesforce.subscription_push.permission_error","code":"DENIED"}',
    );
  });

  it("records completed results before handling the rest of a whole-call error", async () => {
    const rows = [
      outboxRow({ email: "first@example.org" }),
      outboxRow({ email: "second@example.org" }),
    ];
    const h = harness(rows);
    h.writeClient.upsertSubscriptionPreferences.mockRejectedValue(
      new SalesforceWriteError("hidden", "transient", 503, "DOWN", [{
        email: "first@example.org",
        outcome: "updated",
        salesforceId: "a01",
        error: null,
      }]),
    );
    await h.task({}, {} as never);
    const first = rows[0];
    const second = rows[1];
    if (first === undefined || second === undefined) {
      throw new Error("Expected two outbox rows.");
    }
    expect(h.markSent).toHaveBeenCalledWith(
      [first.id],
      new Date("2026-02-01T00:00:00.000Z"),
    );
    expect(h.transitions).toEqual(["sent", "transient"]);
    expect(h.markTransient).toHaveBeenCalledWith(
      [second.id],
      expect.any(Date),
      "DOWN",
    );
  });

  it("marks missing-box rows sent with NO_BOX without calling Salesforce", async () => {
    const skipped = outboxRow({
      eventKind: "project_opt_out",
      projectId: "missing-project",
    });
    const h = harness([skipped]);
    await h.task({}, {} as never);
    expect(h.writeClient.upsertSubscriptionPreferences).not.toHaveBeenCalled();
    expect(h.markSent).toHaveBeenCalledWith(
      [skipped.id],
      new Date("2026-02-01T00:00:00.000Z"),
      "NO_BOX",
    );
  });

  it("stays silent and calls nothing when no rows are due", async () => {
    const h = harness([]);
    await h.task({}, {} as never);
    expect(h.writeClient.upsertSubscriptionPreferences).not.toHaveBeenCalled();
    expect(h.logInfo).not.toHaveBeenCalled();
  });

  it("never emits recipient addresses in run logs", async () => {
    const h = harness();
    h.writeClient.upsertSubscriptionPreferences.mockResolvedValue([{
      email: "person@example.org",
      outcome: "updated",
      salesforceId: "a01",
      error: null,
    }]);
    await h.task({}, {} as never);
    expect(h.logInfo.mock.calls.flat().join(" ")).not.toContain("@");
    expect(h.logError.mock.calls.flat().join(" ")).not.toContain("@");
  });
});
