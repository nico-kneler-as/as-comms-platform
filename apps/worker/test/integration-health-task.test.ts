/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, expect, it, vi } from "vitest";

import { createTaskList } from "../src/tasks.js";
import { pollIntegrationHealthJobName } from "../src/orchestration/tasks.js";
import * as integrationBackfill from "../src/orchestration/integration-backfill.js";
import { createTestWorkerContext } from "./helpers.js";

function toRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function healthResponse(input: {
  readonly service: "gmail" | "salesforce" | "mailchimp" | "simpletexting";
  readonly status:
    | "healthy"
    | "needs_attention"
    | "disconnected"
    | "not_configured"
    | "not_checked";
  readonly checkedAt?: string;
  readonly detail?: string | null;
  readonly version?: string | null;
}): Response {
  return new Response(
    JSON.stringify({
      service: input.service,
      status: input.status,
      checkedAt: input.checkedAt ?? "2026-04-20T16:00:00.000Z",
      detail: input.detail ?? null,
      version: input.version ?? `${input.service}-sha`,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}

function createHealthFetchImplementation(input: {
  readonly gmail: Response;
  readonly salesforce?: Response;
  readonly mailchimp?: Response;
}): (input: string | URL | Request) => Promise<Response> {
  return vi.fn((requestInput: string | URL | Request): Promise<Response> => {
    const url = toRequestUrl(requestInput);

    if (url === "https://gmail-capture.example.test/health") {
      return Promise.resolve(input.gmail.clone());
    }

    if (url === "https://salesforce-capture.example.test/health") {
      return Promise.resolve(
        (input.salesforce ??
          healthResponse({
            service: "salesforce",
            status: "healthy",
          })).clone(),
      );
    }

    if (url === "https://mailchimp-capture.example.test/health") {
      return Promise.resolve(
        (input.mailchimp ??
          healthResponse({
            service: "mailchimp",
            status: "healthy",
          })).clone(),
      );
    }

    return Promise.reject(new Error(`Unexpected health request: ${url}`));
  });
}

async function seedIntegrationHealthRecord(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>,
  input: {
    readonly service: "gmail" | "salesforce" | "mailchimp";
    readonly status:
      | "healthy"
      | "needs_attention"
      | "disconnected"
      | "not_configured"
      | "not_checked";
    readonly degradedSinceAt?: string | null;
    readonly lastAlertSentAt?: string | null;
    readonly updatedAt?: string;
  },
): Promise<void> {
  await context.settings.integrationHealth.seedDefaults();
  const record = await context.settings.integrationHealth.findById(input.service);

  if (record === null) {
    throw new Error(`Expected ${input.service} integration health record to exist.`);
  }

  await context.settings.integrationHealth.upsert({
    ...record,
    status: input.status,
    degradedSinceAt: input.degradedSinceAt ?? null,
    lastAlertSentAt: input.lastAlertSentAt ?? null,
    updatedAt: input.updatedAt ?? record.updatedAt,
  });
}

describe("integration health poller task", () => {
  it("upserts Gmail and Salesforce health rows without crashing on partial failures", async () => {
    const fetchImplementation = vi.fn(
      (input: string | URL | Request): Promise<Response> => {
        const url = toRequestUrl(input);

        if (url === "https://gmail-capture.example.test/health") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                service: "gmail",
                status: "healthy",
                checkedAt: "2026-04-20T16:00:00.000Z",
                detail: null,
                version: "gmail-sha"
              }),
              {
                status: 200,
                headers: {
                  "content-type": "application/json"
                }
              }
            )
          );
        }

        if (url === "https://salesforce-capture.example.test/health") {
          return Promise.resolve(
            new Response("upstream unavailable", {
              status: 503
            })
          );
        }

        if (url === "https://mailchimp-capture.example.test/health") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                service: "mailchimp",
                status: "healthy",
                checkedAt: "2026-04-20T16:00:00.000Z",
                detail: null,
                version: "mailchimp-sha"
              }),
              {
                status: 200,
                headers: {
                  "content-type": "application/json"
                }
              }
            )
          );
        }

        return Promise.reject(new Error(`Unexpected health request: ${url}`));
      }
    );
    const context = await createTestWorkerContext();

    try {
      const taskList = createTaskList(context.orchestration, {
        integrationHealth: {
          integrationHealth: context.settings.integrationHealth,
          opsAlertState: context.settings.opsAlertState,
          captureBaseUrls: {
            gmail: "https://gmail-capture.example.test",
            salesforce: "https://salesforce-capture.example.test",
            mailchimp: "https://mailchimp-capture.example.test"
          },
          persistence: context.persistence,
          fetchImplementation
        }
      });
      const task = taskList[pollIntegrationHealthJobName];

      expect(task).toBeTypeOf("function");
      if (task === undefined) {
        throw new Error("Expected integration health poller task to be registered.");
      }

      await task(undefined, {} as never);

      const gmailRecord = await context.settings.integrationHealth.findById("gmail");
      expect(gmailRecord).not.toBeNull();
      if (gmailRecord === null) {
        throw new Error("Expected Gmail integration health record to exist.");
      }

      expect(gmailRecord.id).toBe("gmail");
      expect(gmailRecord.status).toBe("healthy");
      expect(gmailRecord.degradedSinceAt).toBeNull();
      expect(gmailRecord.lastAlertSentAt).toBeNull();
      expect(gmailRecord.detail).toBeNull();
      expect(typeof gmailRecord.lastCheckedAt).toBe("string");
      expect(gmailRecord.metadataJson).toMatchObject({
        checkedAt: "2026-04-20T16:00:00.000Z",
        version: "gmail-sha"
      });

      const salesforceRecord =
        await context.settings.integrationHealth.findById("salesforce");
      expect(salesforceRecord).not.toBeNull();
      if (salesforceRecord === null) {
        throw new Error("Expected Salesforce integration health record to exist.");
      }

      expect(salesforceRecord.id).toBe("salesforce");
      expect(salesforceRecord.status).toBe("needs_attention");
      expect(typeof salesforceRecord.degradedSinceAt).toBe("string");
      expect(salesforceRecord.lastAlertSentAt).toBeNull();
      expect(salesforceRecord.detail).toBe("Health endpoint returned status 503.");
      expect(typeof salesforceRecord.lastCheckedAt).toBe("string");
      const mailchimpRecord =
        await context.settings.integrationHealth.findById("mailchimp");
      expect(mailchimpRecord).not.toBeNull();
      expect(mailchimpRecord?.status).toBe("healthy");
      expect(mailchimpRecord?.metadataJson).toMatchObject({
        checkedAt: "2026-04-20T16:00:00.000Z",
        version: "mailchimp-sha"
      });
      expect(fetchImplementation).toHaveBeenCalledTimes(3);
    } finally {
      await context.dispose();
    }
  });

  it("debounces a transient blip, alerts only after the debounce window, applies cooldown, then clears state on recovery", async () => {
    let currentTimeIso = "2026-04-20T16:00:00.000Z";
    const gmailHealth = {
      status: "needs_attention" as "needs_attention" | "healthy",
      checkedAt: "2026-04-20T16:00:00.000Z",
      detail: "OAuth token expired." as string | null
    };
    const fetchImplementation = vi.fn(
      (input: string | URL | Request): Promise<Response> => {
        const url = toRequestUrl(input);
        const service = url.includes("gmail")
          ? "gmail"
          : url.includes("mailchimp")
            ? "mailchimp"
            : "salesforce";

        return Promise.resolve(
          new Response(
            JSON.stringify({
              service,
              status: service === "gmail" ? gmailHealth.status : "healthy",
              checkedAt:
                service === "gmail"
                  ? gmailHealth.checkedAt
                  : "2026-04-20T16:00:00.000Z",
              detail: service === "gmail" ? gmailHealth.detail : null,
              version: `${service}-sha`
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json"
              }
            }
          )
        );
      }
    );
    const alertSender = {
      send: vi.fn().mockResolvedValue({
        kind: "success",
        gmailMessageId: "gmail-message-id",
        gmailThreadId: "gmail-thread-id",
        rfc822MessageId: "<alert@example.test>"
      })
    };
    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn()
    };
    const context = await createTestWorkerContext();

    try {
      await context.settings.integrationHealth.seedDefaults();
      const gmailRecord = await context.settings.integrationHealth.findById("gmail");
      if (gmailRecord === null) {
        throw new Error("Expected Gmail integration health record to exist.");
      }

      await context.settings.integrationHealth.upsert({
        ...gmailRecord,
        status: "healthy",
        updatedAt: "2026-04-20T15:55:00.000Z"
      });

      const taskList = createTaskList(context.orchestration, {
        integrationHealth: {
          integrationHealth: context.settings.integrationHealth,
          opsAlertState: context.settings.opsAlertState,
          captureBaseUrls: {
            gmail: "https://gmail-capture.example.test",
            salesforce: "https://salesforce-capture.example.test",
            mailchimp: "https://mailchimp-capture.example.test"
          },
          persistence: context.persistence,
          fetchImplementation,
          alertSender,
          now: () => new Date(currentTimeIso),
          logger
        }
      });
      const task = taskList[pollIntegrationHealthJobName];

      if (task === undefined) {
        throw new Error("Expected integration health poller task to be registered.");
      }

      const helpers = {
        addJob: vi.fn().mockResolvedValue(undefined)
      } as never;

      // Poll 1 — first failed poll. The degraded streak starts now, but the
      // debounce window suppresses the alert.
      currentTimeIso = "2026-04-20T16:00:00.000Z";
      await task(undefined, helpers);
      let record = await context.settings.integrationHealth.findById("gmail");
      expect(alertSender.send).not.toHaveBeenCalled();
      expect(record?.status).toBe("needs_attention");
      expect(record?.degradedSinceAt).toBe("2026-04-20T16:00:00.000Z");
      expect(record?.lastAlertSentAt).toBeNull();

      // Poll 2 — still degraded but only 5 min in, inside the 10 min window.
      currentTimeIso = "2026-04-20T16:05:00.000Z";
      await task(undefined, helpers);
      record = await context.settings.integrationHealth.findById("gmail");
      expect(alertSender.send).not.toHaveBeenCalled();
      expect(record?.degradedSinceAt).toBe("2026-04-20T16:00:00.000Z");
      expect(record?.lastAlertSentAt).toBeNull();

      // Poll 3 — the debounce window (10 min) has elapsed, so the first alert
      // fires. fromStatus is "needs_attention" (not "healthy") because the
      // healthy→degraded edge is now in the past — the debounce delayed us.
      currentTimeIso = "2026-04-20T16:10:00.000Z";
      await task(undefined, helpers);
      record = await context.settings.integrationHealth.findById("gmail");
      expect(alertSender.send).toHaveBeenCalledTimes(1);
      expect(alertSender.send).toHaveBeenCalledWith(
        expect.objectContaining({
          service: "gmail",
          fromStatus: "needs_attention",
          occurredAt: "2026-04-20T16:10:00.000Z",
          record: expect.objectContaining({
            status: "needs_attention",
            detail: "OAuth token expired.",
            metadataJson: expect.objectContaining({
              version: "gmail-sha"
            })
          })
        })
      );
      expect(record?.degradedSinceAt).toBe("2026-04-20T16:00:00.000Z");
      expect(record?.lastAlertSentAt).toBe("2026-04-20T16:10:00.000Z");
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('"event":"integration_health.alert_sent"')
      );

      // Poll 4 — still degraded but inside the 1 hour re-alert cooldown.
      currentTimeIso = "2026-04-20T16:12:00.000Z";
      await task(undefined, helpers);
      expect(alertSender.send).toHaveBeenCalledTimes(1);

      // Poll 5 — recovery clears the degraded + alert state without paging.
      gmailHealth.status = "healthy";
      gmailHealth.checkedAt = "2026-04-20T16:30:00.000Z";
      gmailHealth.detail = null;
      currentTimeIso = "2026-04-20T16:30:00.000Z";
      await task(undefined, helpers);
      const recoveredRecord =
        await context.settings.integrationHealth.findById("gmail");

      expect(alertSender.send).toHaveBeenCalledTimes(1);
      expect(recoveredRecord?.status).toBe("healthy");
      expect(recoveredRecord?.degradedSinceAt).toBeNull();
      expect(recoveredRecord?.lastAlertSentAt).toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("never alerts when a transient blip recovers within the debounce window", async () => {
    let currentTimeIso = "2026-04-20T16:00:00.000Z";
    const gmailHealth = {
      status: "needs_attention" as "needs_attention" | "healthy",
      detail: "OAuth token exchange timed out." as string | null
    };
    const fetchImplementation = vi.fn(
      (input: string | URL | Request): Promise<Response> => {
        const url = toRequestUrl(input);
        const service = url.includes("gmail")
          ? "gmail"
          : url.includes("mailchimp")
            ? "mailchimp"
            : "salesforce";

        return Promise.resolve(
          new Response(
            JSON.stringify({
              service,
              status: service === "gmail" ? gmailHealth.status : "healthy",
              checkedAt: currentTimeIso,
              detail: service === "gmail" ? gmailHealth.detail : null,
              version: `${service}-sha`
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json"
              }
            }
          )
        );
      }
    );
    const alertSender = { send: vi.fn() };
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const context = await createTestWorkerContext();

    try {
      await context.settings.integrationHealth.seedDefaults();
      const gmailRecord = await context.settings.integrationHealth.findById("gmail");
      if (gmailRecord === null) {
        throw new Error("Expected Gmail integration health record to exist.");
      }
      await context.settings.integrationHealth.upsert({
        ...gmailRecord,
        status: "healthy",
        updatedAt: "2026-04-20T15:55:00.000Z"
      });

      const taskList = createTaskList(context.orchestration, {
        integrationHealth: {
          integrationHealth: context.settings.integrationHealth,
          opsAlertState: context.settings.opsAlertState,
          captureBaseUrls: {
            gmail: "https://gmail-capture.example.test",
            salesforce: "https://salesforce-capture.example.test",
            mailchimp: "https://mailchimp-capture.example.test"
          },
          persistence: context.persistence,
          fetchImplementation,
          alertSender,
          now: () => new Date(currentTimeIso),
          logger
        }
      });
      const task = taskList[pollIntegrationHealthJobName];
      if (task === undefined) {
        throw new Error("Expected integration health poller task to be registered.");
      }
      const helpers = {
        addJob: vi.fn().mockResolvedValue(undefined)
      } as never;

      // Poll 1 — degraded. Debounced, so no alert; degradedSinceAt recorded.
      currentTimeIso = "2026-04-20T16:00:00.000Z";
      await task(undefined, helpers);
      const degradedRecord =
        await context.settings.integrationHealth.findById("gmail");
      expect(degradedRecord?.degradedSinceAt).toBe("2026-04-20T16:00:00.000Z");
      expect(alertSender.send).not.toHaveBeenCalled();

      // Poll 2 — recovered 5 min later, still inside the debounce window, so no
      // alert is ever sent and the degraded state is cleared.
      gmailHealth.status = "healthy";
      gmailHealth.detail = null;
      currentTimeIso = "2026-04-20T16:05:00.000Z";
      await task(undefined, helpers);
      const recoveredRecord =
        await context.settings.integrationHealth.findById("gmail");
      expect(alertSender.send).not.toHaveBeenCalled();
      expect(recoveredRecord?.status).toBe("healthy");
      expect(recoveredRecord?.degradedSinceAt).toBeNull();
      expect(recoveredRecord?.lastAlertSentAt).toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("enqueues a gmail backfill when gmail recovers from needs_attention", async () => {
    const fetchImplementation = createHealthFetchImplementation({
      gmail: healthResponse({
        service: "gmail",
        status: "healthy",
        checkedAt: "2026-04-20T16:00:00.000Z",
      }),
    });
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const addJob = vi.fn().mockResolvedValue(undefined);
    const enqueueSpy = vi.spyOn(
      integrationBackfill,
      "enqueueIntegrationBackfillGmailJob",
    );
    const context = await createTestWorkerContext();

    try {
      await seedIntegrationHealthRecord(context, {
        service: "gmail",
        status: "needs_attention",
        degradedSinceAt: "2026-04-20T15:30:00.000Z",
      });

      const task = createTaskList(context.orchestration, {
        integrationHealth: {
          integrationHealth: context.settings.integrationHealth,
          opsAlertState: context.settings.opsAlertState,
          persistence: context.persistence,
          captureBaseUrls: {
            gmail: "https://gmail-capture.example.test",
            salesforce: "https://salesforce-capture.example.test",
            mailchimp: "https://mailchimp-capture.example.test",
          },
          fetchImplementation,
          now: () => new Date("2026-04-20T16:00:00.000Z"),
          logger,
        },
      })[pollIntegrationHealthJobName];

      if (task === undefined) {
        throw new Error("Expected integration health poller task to be registered.");
      }

      await task(undefined, { addJob } as never);

      expect(enqueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          persistence: context.persistence,
          addJob,
          service: "gmail",
          triggeredBy: "integration_health_transition",
          idempotencyKey: "gmail:2026-04-20T15:30:00.000Z",
          windowStart: "2026-04-20T15:30:00.000Z",
          windowEnd: "2026-04-20T16:00:00.000Z",
          mailbox: null,
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('"event":"integration_health.transition_detected"'),
      );

      const updated = await context.settings.integrationHealth.findById("gmail");
      expect(updated?.status).toBe("healthy");
      expect(updated?.degradedSinceAt).toBeNull();
    } finally {
      enqueueSpy.mockRestore();
      await context.dispose();
    }
  });

  it("enqueues a gmail backfill when gmail recovers from disconnected", async () => {
    const fetchImplementation = createHealthFetchImplementation({
      gmail: healthResponse({
        service: "gmail",
        status: "healthy",
      }),
    });
    const enqueueSpy = vi.spyOn(
      integrationBackfill,
      "enqueueIntegrationBackfillGmailJob",
    );
    const context = await createTestWorkerContext();

    try {
      await seedIntegrationHealthRecord(context, {
        service: "gmail",
        status: "disconnected",
        degradedSinceAt: "2026-04-20T15:00:00.000Z",
      });

      const task = createTaskList(context.orchestration, {
        integrationHealth: {
          integrationHealth: context.settings.integrationHealth,
          opsAlertState: context.settings.opsAlertState,
          persistence: context.persistence,
          captureBaseUrls: {
            gmail: "https://gmail-capture.example.test",
            salesforce: "https://salesforce-capture.example.test",
            mailchimp: "https://mailchimp-capture.example.test",
          },
          fetchImplementation,
          now: () => new Date("2026-04-20T16:00:00.000Z"),
        },
      })[pollIntegrationHealthJobName];

      if (task === undefined) {
        throw new Error("Expected integration health poller task to be registered.");
      }

      await task(undefined, { addJob: vi.fn().mockResolvedValue(undefined) } as never);

      expect(enqueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: "gmail:2026-04-20T15:00:00.000Z",
          windowStart: "2026-04-20T15:00:00.000Z",
          windowEnd: "2026-04-20T16:00:00.000Z",
        }),
      );
    } finally {
      enqueueSpy.mockRestore();
      await context.dispose();
    }
  });

  it("does not enqueue when gmail transitions from not_configured to healthy", async () => {
    const fetchImplementation = createHealthFetchImplementation({
      gmail: healthResponse({
        service: "gmail",
        status: "healthy",
      }),
    });
    const enqueueSpy = vi.spyOn(
      integrationBackfill,
      "enqueueIntegrationBackfillGmailJob",
    );
    const context = await createTestWorkerContext();

    try {
      await seedIntegrationHealthRecord(context, {
        service: "gmail",
        status: "not_configured",
      });

      const task = createTaskList(context.orchestration, {
        integrationHealth: {
          integrationHealth: context.settings.integrationHealth,
          opsAlertState: context.settings.opsAlertState,
          persistence: context.persistence,
          captureBaseUrls: {
            gmail: "https://gmail-capture.example.test",
            salesforce: "https://salesforce-capture.example.test",
            mailchimp: "https://mailchimp-capture.example.test",
          },
          fetchImplementation,
        },
      })[pollIntegrationHealthJobName];

      if (task === undefined) {
        throw new Error("Expected integration health poller task to be registered.");
      }

      await task(undefined, { addJob: vi.fn().mockResolvedValue(undefined) } as never);

      expect(enqueueSpy).not.toHaveBeenCalled();
    } finally {
      enqueueSpy.mockRestore();
      await context.dispose();
    }
  });

  it("does not enqueue when gmail stays healthy", async () => {
    const fetchImplementation = createHealthFetchImplementation({
      gmail: healthResponse({
        service: "gmail",
        status: "healthy",
      }),
    });
    const enqueueSpy = vi.spyOn(
      integrationBackfill,
      "enqueueIntegrationBackfillGmailJob",
    );
    const context = await createTestWorkerContext();

    try {
      await seedIntegrationHealthRecord(context, {
        service: "gmail",
        status: "healthy",
      });

      const task = createTaskList(context.orchestration, {
        integrationHealth: {
          integrationHealth: context.settings.integrationHealth,
          opsAlertState: context.settings.opsAlertState,
          persistence: context.persistence,
          captureBaseUrls: {
            gmail: "https://gmail-capture.example.test",
            salesforce: "https://salesforce-capture.example.test",
            mailchimp: "https://mailchimp-capture.example.test",
          },
          fetchImplementation,
        },
      })[pollIntegrationHealthJobName];

      if (task === undefined) {
        throw new Error("Expected integration health poller task to be registered.");
      }

      await task(undefined, { addJob: vi.fn().mockResolvedValue(undefined) } as never);

      expect(enqueueSpy).not.toHaveBeenCalled();
    } finally {
      enqueueSpy.mockRestore();
      await context.dispose();
    }
  });

  it("does not enqueue when gmail degrades from healthy to needs_attention", async () => {
    const fetchImplementation = createHealthFetchImplementation({
      gmail: healthResponse({
        service: "gmail",
        status: "needs_attention",
        detail: "OAuth token expired.",
      }),
    });
    const enqueueSpy = vi.spyOn(
      integrationBackfill,
      "enqueueIntegrationBackfillGmailJob",
    );
    const context = await createTestWorkerContext();

    try {
      await seedIntegrationHealthRecord(context, {
        service: "gmail",
        status: "healthy",
      });

      const task = createTaskList(context.orchestration, {
        integrationHealth: {
          integrationHealth: context.settings.integrationHealth,
          opsAlertState: context.settings.opsAlertState,
          persistence: context.persistence,
          captureBaseUrls: {
            gmail: "https://gmail-capture.example.test",
            salesforce: "https://salesforce-capture.example.test",
            mailchimp: "https://mailchimp-capture.example.test",
          },
          fetchImplementation,
          now: () => new Date("2026-04-20T16:00:00.000Z"),
        },
      })[pollIntegrationHealthJobName];

      if (task === undefined) {
        throw new Error("Expected integration health poller task to be registered.");
      }

      await task(undefined, { addJob: vi.fn().mockResolvedValue(undefined) } as never);

      expect(enqueueSpy).not.toHaveBeenCalled();
      const updated = await context.settings.integrationHealth.findById("gmail");
      expect(updated?.degradedSinceAt).toBe("2026-04-20T16:00:00.000Z");
    } finally {
      enqueueSpy.mockRestore();
      await context.dispose();
    }
  });

  it("skips non-gmail recovery transitions with a structured log", async () => {
    const fetchImplementation = createHealthFetchImplementation({
      gmail: healthResponse({
        service: "gmail",
        status: "healthy",
      }),
      mailchimp: healthResponse({
        service: "mailchimp",
        status: "healthy",
      }),
    });
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const enqueueSpy = vi.spyOn(
      integrationBackfill,
      "enqueueIntegrationBackfillGmailJob",
    );
    const context = await createTestWorkerContext();

    try {
      await seedIntegrationHealthRecord(context, {
        service: "mailchimp",
        status: "needs_attention",
        degradedSinceAt: "2026-04-20T15:00:00.000Z",
      });

      const task = createTaskList(context.orchestration, {
        integrationHealth: {
          integrationHealth: context.settings.integrationHealth,
          opsAlertState: context.settings.opsAlertState,
          persistence: context.persistence,
          captureBaseUrls: {
            gmail: "https://gmail-capture.example.test",
            salesforce: "https://salesforce-capture.example.test",
            mailchimp: "https://mailchimp-capture.example.test",
          },
          fetchImplementation,
          now: () => new Date("2026-04-20T16:00:00.000Z"),
          logger,
        },
      })[pollIntegrationHealthJobName];

      if (task === undefined) {
        throw new Error("Expected integration health poller task to be registered.");
      }

      await task(undefined, { addJob: vi.fn().mockResolvedValue(undefined) } as never);

      expect(enqueueSpy).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('"event":"integration_backfill.skipped"'),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('"reason":"service_not_yet_supported"'),
      );
    } finally {
      enqueueSpy.mockRestore();
      await context.dispose();
    }
  });

  it("caps the recovery window to 24 hours before enqueueing", async () => {
    const fetchImplementation = createHealthFetchImplementation({
      gmail: healthResponse({
        service: "gmail",
        status: "healthy",
      }),
    });
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const enqueueSpy = vi.spyOn(
      integrationBackfill,
      "enqueueIntegrationBackfillGmailJob",
    );
    const context = await createTestWorkerContext();

    try {
      await seedIntegrationHealthRecord(context, {
        service: "gmail",
        status: "needs_attention",
        degradedSinceAt: "2026-04-19T10:00:00.000Z",
      });

      const task = createTaskList(context.orchestration, {
        integrationHealth: {
          integrationHealth: context.settings.integrationHealth,
          opsAlertState: context.settings.opsAlertState,
          persistence: context.persistence,
          captureBaseUrls: {
            gmail: "https://gmail-capture.example.test",
            salesforce: "https://salesforce-capture.example.test",
            mailchimp: "https://mailchimp-capture.example.test",
          },
          fetchImplementation,
          now: () => new Date("2026-04-20T16:00:00.000Z"),
          logger,
        },
      })[pollIntegrationHealthJobName];

      if (task === undefined) {
        throw new Error("Expected integration health poller task to be registered.");
      }

      await task(undefined, { addJob: vi.fn().mockResolvedValue(undefined) } as never);

      expect(enqueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          windowStart: "2026-04-19T16:00:00.000Z",
          windowEnd: "2026-04-20T16:00:00.000Z",
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('"event":"integration_backfill.window_capped"'),
      );
    } finally {
      enqueueSpy.mockRestore();
      await context.dispose();
    }
  });

  it("logs enqueue failures and leaves the row degraded for the next poll", async () => {
    const fetchImplementation = createHealthFetchImplementation({
      gmail: healthResponse({
        service: "gmail",
        status: "healthy",
      }),
    });
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const enqueueSpy = vi
      .spyOn(integrationBackfill, "enqueueIntegrationBackfillGmailJob")
      .mockRejectedValueOnce(new Error("queue unavailable"));
    const context = await createTestWorkerContext();

    try {
      await seedIntegrationHealthRecord(context, {
        service: "gmail",
        status: "needs_attention",
        degradedSinceAt: "2026-04-20T15:30:00.000Z",
      });

      const task = createTaskList(context.orchestration, {
        integrationHealth: {
          integrationHealth: context.settings.integrationHealth,
          opsAlertState: context.settings.opsAlertState,
          persistence: context.persistence,
          captureBaseUrls: {
            gmail: "https://gmail-capture.example.test",
            salesforce: "https://salesforce-capture.example.test",
            mailchimp: "https://mailchimp-capture.example.test",
          },
          fetchImplementation,
          now: () => new Date("2026-04-20T16:00:00.000Z"),
          logger,
        },
      })[pollIntegrationHealthJobName];

      if (task === undefined) {
        throw new Error("Expected integration health poller task to be registered.");
      }

      await expect(
        task(undefined, { addJob: vi.fn().mockResolvedValue(undefined) } as never),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('"event":"integration_backfill.enqueue_failed"'),
      );

      const updated = await context.settings.integrationHealth.findById("gmail");
      expect(updated?.status).toBe("needs_attention");
      expect(updated?.degradedSinceAt).toBe("2026-04-20T15:30:00.000Z");
    } finally {
      enqueueSpy.mockRestore();
      await context.dispose();
    }
  });
});
