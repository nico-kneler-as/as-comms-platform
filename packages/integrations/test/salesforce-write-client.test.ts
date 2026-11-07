import { beforeEach, describe, expect, it, vi } from "vitest";

const exchange = vi.hoisted(() => vi.fn());
vi.mock("../src/capture-services/salesforce.js", () => ({
  exchangeSalesforceAccessToken: exchange,
}));

import {
  createSalesforceWriteClient,
  SalesforceWriteError,
} from "../src/salesforce-write-client.js";

const config = {
  loginUrl: "https://login.example.test",
  clientId: "client",
  username: "worker@example.test",
  jwtPrivateKey: "private-key",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Salesforce write client", () => {
  beforeEach(() => {
    exchange.mockReset();
    exchange.mockResolvedValue({
      accessToken: "token",
      instanceUrl: "https://instance.example.test",
      expiresAtEpochMs: Date.now() + 60_000,
    });
  });

  it("normalizes emails and serializes only supplied values", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response([{ id: "a00", success: true, created: true, errors: [] }]),
      );
    const client = createSalesforceWriteClient(config, { fetchImplementation });
    await expect(
      client.upsertSubscriptionPreferences([
        {
          email: " Person@Example.org ",
          contactId: null,
          projectBoxes: { "PNW Forest Monitoring": true },
        },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        email: "person@example.org",
        outcome: "created",
      }),
    ]);
    const requestBody = fetchImplementation.mock.calls[0]?.[1]?.body;
    if (typeof requestBody !== "string")
      throw new Error("Expected JSON request body.");
    const body = JSON.parse(requestBody) as {
      records: Record<string, unknown>[];
    };
    expect(body.records[0]).toMatchObject({
      Email__c: "person@example.org",
      Contact__c: null,
      PNW_Forest_Monitoring__c: true,
    });
    expect(body.records[0]).not.toHaveProperty("Email_Bounced__c");
  });

  it("chunks sequentially, preserves input order, and refuses duplicate normalized keys", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation((_url, init) => {
        if (typeof init?.body !== "string")
          throw new Error("Expected JSON request body.");
        const body = JSON.parse(init.body) as { records: unknown[] };
        return Promise.resolve(
          response(
            body.records.map((_, index) => ({
              id: `id-${String(index)}`,
              success: true,
              created: index % 2 === 0,
              errors: [],
            })),
          ),
        );
      });
    const client = createSalesforceWriteClient(config, { fetchImplementation });
    const changes = Array.from({ length: 450 }, (_, index) => ({
      email: `person-${String(index)}@example.org`,
      emailBounced: false,
    }));
    const results = await client.upsertSubscriptionPreferences(changes);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(450);
    expect(results[0]?.outcome).toBe("created");
    expect(results[1]?.outcome).toBe("updated");
    await expect(
      client.upsertSubscriptionPreferences([
        { email: "Person@example.org", emailBounced: false },
        { email: " person@example.org ", emailBounced: true },
      ]),
    ).rejects.toThrow("Duplicate normalized");
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it("returns invalid-email failures while sending valid records and classifies record errors", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      response([
        {
          id: null,
          success: false,
          errors: [{ errorCode: "UNABLE_TO_LOCK_ROW", message: "lock" }],
        },
      ]),
    );
    const client = createSalesforceWriteClient(config, { fetchImplementation });
    const results = await client.upsertSubscriptionPreferences([
      { email: "nope", emailBounced: false },
      { email: "ok@example.org", emailBounced: false },
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(results[0]?.error).toMatchObject({
      kind: "permanent",
      code: "INVALID_EMAIL_INPUT",
    });
    expect(results[1]?.error).toMatchObject({
      kind: "transient",
      code: "UNABLE_TO_LOCK_ROW",
    });
  });

  it("classifies permission codes, including Salesforce flow access errors", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      response([
        {
          id: null,
          success: false,
          errors: [
            {
              errorCode: "INSUFFICIENT_ACCESS_OR_READONLY",
              message: "no access",
            },
          ],
        },
        {
          id: null,
          success: false,
          errors: [
            {
              errorCode: "CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY",
              message: "flow access denied",
            },
          ],
        },
        {
          id: null,
          success: false,
          errors: [
            {
              errorCode: "CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY",
              message: "flow validation failed",
            },
          ],
        },
      ]),
    );
    const client = createSalesforceWriteClient(config, { fetchImplementation });
    const results = await client.upsertSubscriptionPreferences([
      { email: "permission-1@example.org", emailBounced: false },
      { email: "permission-2@example.org", emailBounced: false },
      { email: "permission-3@example.org", emailBounced: false },
    ]);
    expect(results.map((item) => item.error?.kind)).toEqual([
      "permission",
      "permission",
      "permanent",
    ]);
  });

  it("refreshes once after 401 and carries completed chunks on later failure", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(
          [{ errorCode: "INVALID_SESSION_ID", message: "expired" }],
          401,
        ),
      )
      .mockResolvedValueOnce(
        response([{ id: "a00", success: true, created: false, errors: [] }]),
      )
      .mockResolvedValueOnce(
        response(
          Array.from({ length: 200 }, () => ({
            id: "a00",
            success: true,
            created: false,
            errors: [],
          })),
        ),
      )
      .mockResolvedValueOnce(
        response([{ errorCode: "INVALID_FIELD", message: "no field" }], 400),
      );
    const client = createSalesforceWriteClient(config, { fetchImplementation });
    await client.upsertSubscriptionPreferences([
      { email: "one@example.org", emailBounced: false },
    ]);
    expect(exchange).toHaveBeenCalledTimes(2);
    try {
      await client.upsertSubscriptionPreferences(
        Array.from({ length: 201 }, (_, index) => ({
          email: `later-${String(index)}@example.org`,
          emailBounced: false,
        })),
      );
      throw new Error("Expected Salesforce write to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(SalesforceWriteError);
      if (!(error instanceof SalesforceWriteError)) throw error;
      expect(error.kind).toBe("permission");
      expect(error.completedResults).toContainEqual(
        expect.objectContaining({ email: "later-0@example.org" }),
      );
    }
  });

  it("patches expedition member status and rejects invalid identifiers before fetch", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const client = createSalesforceWriteClient(config, { fetchImplementation });
    await client.setExpeditionMemberStatus("a0A000000000001AAA", " Approved ");
    expect(fetchImplementation.mock.calls[0]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ Status__c: "Approved" }),
    });
    await expect(
      client.setExpeditionMemberStatus("bad", "Approved"),
    ).rejects.toThrow("Salesforce ID");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});
