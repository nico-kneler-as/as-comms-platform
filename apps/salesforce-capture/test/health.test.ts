import { describe, expect, it, vi } from "vitest";

import {
  handleSalesforceHealthRequest,
  readSalesforceCaptureRuntimeConfig
} from "../src/index.js";

function createConfig() {
  return readSalesforceCaptureRuntimeConfig({
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
    SALESFORCE_MEMBERSHIP_CAPTURE_MODE: "delta_polling"
  });
}

function toRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

describe("Salesforce /health", () => {
  it("returns healthy when token exchange and describe both succeed", async () => {
    const fetchImplementation = vi.fn(
      (input: string | URL | Request): Response => {
        const url = toRequestUrl(input);

        if (url.endsWith("/services/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: "salesforce-access-token",
              instance_url: "https://instance.salesforce.com"
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        if (
          url ===
          "https://instance.salesforce.com/services/data/v61.0/sobjects/Contact/describe"
        ) {
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          });
        }

        throw new Error(`Unexpected Salesforce health request: ${url}`);
      }
    );
    const result = await handleSalesforceHealthRequest(createConfig(), {
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
      now: () => new Date("2026-04-20T16:00:00.000Z"),
      version: "salesforce-sha"
    });

    expect(result).toEqual({
      service: "salesforce",
      status: "healthy",
      checkedAt: "2026-04-20T16:00:00.000Z",
      detail: null,
      version: "salesforce-sha"
    });
  });

  it("returns disconnected when Salesforce rejects the authenticated describe call", async () => {
    const fetchImplementation = vi.fn(
      (input: string | URL | Request): Response => {
        const url = toRequestUrl(input);

        if (url.endsWith("/services/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: "salesforce-access-token",
              instance_url: "https://instance.salesforce.com"
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        return new Response("unauthorized", {
          status: 401
        });
      }
    );
    const result = await handleSalesforceHealthRequest(createConfig(), {
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
      now: () => new Date("2026-04-20T16:00:00.000Z")
    });

    expect(result).toMatchObject({
      service: "salesforce",
      status: "disconnected",
      detail: "Invalid or expired credentials."
    });
  });

  it("returns needs_attention when the describe request fails", async () => {
    const fetchImplementation = vi.fn(
      (input: string | URL | Request): Response => {
        const url = toRequestUrl(input);

        if (url.endsWith("/services/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: "salesforce-access-token",
              instance_url: "https://instance.salesforce.com"
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json"
              }
            }
          );
        }

        throw new TypeError("network failure");
      }
    );
    const result = await handleSalesforceHealthRequest(createConfig(), {
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
      now: () => new Date("2026-04-20T16:00:00.000Z")
    });

    expect(result).toMatchObject({
      service: "salesforce",
      status: "needs_attention",
      detail: "Salesforce describe request failed."
    });
  });
});
