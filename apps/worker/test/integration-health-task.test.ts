/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, expect, it, vi } from "vitest";

import { createTaskList } from "../src/tasks.js";
import { pollIntegrationHealthJobName } from "../src/orchestration/tasks.js";
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

        return Promise.reject(new Error(`Unexpected health request: ${url}`));
      }
    );
    const context = await createTestWorkerContext();

    try {
      const taskList = createTaskList(context.orchestration, {
        integrationHealth: {
          integrationHealth: context.settings.integrationHealth,
          captureBaseUrls: {
            gmail: "https://gmail-capture.example.test",
            salesforce: "https://salesforce-capture.example.test"
          },
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
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
    } finally {
      await context.dispose();
    }
  });

  it("sends one degradation alert, applies cooldown, and clears state on recovery", async () => {
    const fetchImplementation = vi.fn(
      (input: string | URL | Request): Promise<Response> => {
        const url = toRequestUrl(input);
        const service = url.includes("gmail") ? "gmail" : "salesforce";

        return Promise.resolve(
          new Response(
            JSON.stringify({
              service,
              status: service === "gmail" ? "needs_attention" : "healthy",
              checkedAt: "2026-04-20T16:00:00.000Z",
              detail: service === "gmail" ? "OAuth token expired." : null,
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
          captureBaseUrls: {
            gmail: "https://gmail-capture.example.test",
            salesforce: "https://salesforce-capture.example.test"
          },
          fetchImplementation,
          alertSender,
          now: () => new Date("2026-04-20T16:00:00.000Z"),
          logger
        }
      });
      const task = taskList[pollIntegrationHealthJobName];

      if (task === undefined) {
        throw new Error("Expected integration health poller task to be registered.");
      }

      await task(undefined, {} as never);
      await task(undefined, {} as never);

      const degradedRecord =
        await context.settings.integrationHealth.findById("gmail");

      expect(alertSender.send).toHaveBeenCalledTimes(1);
      expect(alertSender.send).toHaveBeenCalledWith(
        expect.objectContaining({
          service: "gmail",
          fromStatus: "healthy",
          occurredAt: "2026-04-20T16:00:00.000Z",
          record: expect.objectContaining({
            status: "needs_attention",
            detail: "OAuth token expired.",
            metadataJson: expect.objectContaining({
              checkedAt: "2026-04-20T16:00:00.000Z",
              version: "gmail-sha"
            })
          })
        })
      );
      expect(degradedRecord?.degradedSinceAt).toBe(
        "2026-04-20T16:00:00.000Z"
      );
      expect(degradedRecord?.lastAlertSentAt).toBe(
        "2026-04-20T16:00:00.000Z"
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('"event":"integration_health.alert_sent"')
      );

      fetchImplementation.mockImplementation(
        (input: string | URL | Request): Promise<Response> => {
          const url = toRequestUrl(input);
          const service = url.includes("gmail") ? "gmail" : "salesforce";

          return Promise.resolve(
            new Response(
              JSON.stringify({
                service,
                status: "healthy",
                checkedAt: "2026-04-20T16:30:00.000Z",
                detail: null,
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

      await task(undefined, {} as never);

      const recoveredRecord =
        await context.settings.integrationHealth.findById("gmail");

      expect(recoveredRecord?.status).toBe("healthy");
      expect(recoveredRecord?.degradedSinceAt).toBeNull();
      expect(recoveredRecord?.lastAlertSentAt).toBeNull();
    } finally {
      await context.dispose();
    }
  });
});
