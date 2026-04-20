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
      expect(salesforceRecord.detail).toBe("Health endpoint returned status 503.");
      expect(typeof salesforceRecord.lastCheckedAt).toBe("string");
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
    } finally {
      await context.dispose();
    }
  });
});
