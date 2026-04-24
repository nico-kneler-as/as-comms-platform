import { createServer } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import type * as IntegrationsModule from "@as-comms/integrations";

const { createSalesforceCaptureServiceMock } = vi.hoisted(() => ({
  createSalesforceCaptureServiceMock: vi.fn(),
}));

vi.mock("@as-comms/integrations", async () => {
  const actual = await vi.importActual<typeof IntegrationsModule>(
    "@as-comms/integrations",
  );

  return {
    ...actual,
    createSalesforceCaptureService: createSalesforceCaptureServiceMock,
  };
});

import {
  readSalesforceCaptureRuntimeConfig,
  startSalesforceCaptureServer,
} from "../src/index.js";

function createConfig(port: number) {
  return readSalesforceCaptureRuntimeConfig({
    HOST: "127.0.0.1",
    PORT: String(port),
    SALESFORCE_CAPTURE_TOKEN: "salesforce-token",
    SALESFORCE_LOGIN_URL: "https://test.salesforce.com",
    SALESFORCE_CLIENT_ID: "salesforce-client-id",
    SALESFORCE_USERNAME: "worker@example.org",
    SALESFORCE_JWT_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----
MIICdwIBADANBgkqhkiG9w0BAQEFAASCAmEwggJdAgEAAoGBAOpC2YU1CUgOjNp+
U8vch5eul83Qjq3IKkWWRQIfHualLi+CKRdYGpqZX+qis+rN3vA2VkY4ykKxtveQ
nVl0lJVCb36QDDd96dTMZrcdrGvXHLP1dMfSZHRPmtGuysB5LYlF8viWMxvV7kiS
a1xSTGS3KfikGuzLrEZpYYP/qGFxAgMBAAECgYA5sTT4xVL/1/WAadQhRLJv/KOO
IGrDCaS/dn6QQzHNA6kYMioEgcIriNJCasd8cC8TYY5lxN6rBjFVTtwxh7B/iTGu
xdsfUkWbmubU7le7KfDLe2kOYmm9qxH3aMCxhiTAnkTOrZ1hZfpjVrQYuR19aXU6
IUMLF4Ph4t5K+4jPcQJBAPqidE+1FBO3A5rxeYBOL2BY8c1U8DG2Z3MMEpArJwRk
tVeBftejaybo/T3bsylHk6Mw3YqHbIa6uGyqDpq72jsCQQDvRqoThKxOhZU6zyUK
/YW3WinixUcsEPWgvCI9pXa09F7kJIB+m6IqO+Y+zvzjYnwUHx2pYxZGnAI864R3
EoxDAkEA+DDbQPst0IAQ/+RTzyydWal6eTy9Rl08f/7aew1ga8dWlDrV4rAfMb7S
1+ixuBT7LET9fWqxm5FXg7O7FpsjdQJABJXuHIGma7rTqVTe+N7y+RiZROdS/d01
V+dDILtTExS73NN2QvbonLaZKwr8fb8dcaVHBEAJ5UCIKnK5Dy8j0QJBAKhVH0mU
PZpRE1PvSL887gSHwWFelB7BlDbijc2M5fKrPC2KO/hJhg0wgnzVE1/UGwKWSSDX
ZsMs9ff6x7BET58=
-----END PRIVATE KEY-----`,
    SALESFORCE_CONTACT_CAPTURE_MODE: "cdc_compatible",
    SALESFORCE_MEMBERSHIP_CAPTURE_MODE: "delta_polling",
  });
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        reject(new Error("Failed to resolve an available port."));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

afterEach(() => {
  createSalesforceCaptureServiceMock.mockReset();
  vi.restoreAllMocks();
});

describe("Salesforce capture server", () => {
  it("logs safe structured details and returns generic 500 bodies for live request failures", async () => {
    const port = await getAvailablePort();
    const serviceError = new TypeError("Salesforce live failure");
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    createSalesforceCaptureServiceMock.mockReturnValue({
      handleHttpRequest: vi.fn(() => {
        throw serviceError;
      }),
    });

    const server = await startSalesforceCaptureServer(createConfig(port));

    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/live`, {
        method: "POST",
        headers: {
          authorization: "Bearer salesforce-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jobId: "job:salesforce:live:1",
        }),
      });

      expect(response.status).toBe(500);
      const responseBody = (await response.json()) as Record<string, unknown>;
      expect(responseBody).toMatchObject({
        ok: false,
        error: "internal_error",
      });
      expect(typeof responseBody.requestId).toBe("string");

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

      const loggedError = JSON.parse(
        String(consoleErrorSpy.mock.calls[0]?.[0] ?? ""),
      ) as Record<string, unknown>;

      expect(loggedError).toMatchObject({
        event: "salesforce_capture.live.error",
        requestId: responseBody.requestId,
        errorName: "TypeError",
        requestMethod: "POST",
        requestPath: "/live",
      });
      expect(loggedError).not.toHaveProperty("errorMessage");
      expect(loggedError).not.toHaveProperty("errorStack");
      expect(loggedError).not.toHaveProperty("requestBody");
      expect(typeof loggedError.occurredAt).toBe("string");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  });

  it("rejects oversized request bodies before invoking the capture service", async () => {
    const port = await getAvailablePort();
    const handleHttpRequest = vi.fn();

    createSalesforceCaptureServiceMock.mockReturnValue({
      handleHttpRequest,
    });

    const server = await startSalesforceCaptureServer(createConfig(port));

    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/live`, {
        method: "POST",
        headers: {
          authorization: "Bearer salesforce-token",
          "content-type": "application/json",
        },
        body: "x".repeat(1_000_001),
      });

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "payload_too_large",
      });
      expect(handleHttpRequest).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  });
});
