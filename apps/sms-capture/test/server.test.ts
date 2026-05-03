import type { Server } from "node:http";

import { smsSenders } from "@as-comms/db";
import { createTestStage1Context, type TestStage1Context } from "@as-comms/db/test-helpers";
import type { TwilioProvider } from "@as-comms/integrations";
import { afterEach, describe, expect, it } from "vitest";

import {
  createSmsCaptureServer,
  readSmsCaptureRuntimeConfig,
} from "../src/server.js";

const servers: Server[] = [];
const contexts: TestStage1Context[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) {
              resolve();
              return;
            }

            reject(error);
          });
        }),
    ),
  );
  await Promise.all(contexts.splice(0).map((context) => context.dispose()));
});

function listen(server: Server): Promise<string> {
  servers.push(server);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolve(`http://127.0.0.1:${address.port.toString()}`);
        return;
      }

      reject(new Error("Expected TCP server address."));
    });
  });
}

function buildConfig() {
  return readSmsCaptureRuntimeConfig({
    DATABASE_URL: "postgres://ignored",
    TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
    TWILIO_AUTH_TOKEN: "twilio-token",
    TWILIO_MESSAGING_SERVICE_SID_OR_FROM_NUMBER: "+14065550142",
  });
}

describe("SMS capture server", () => {
  it("rejects unsigned inbound webhook requests", async () => {
    const baseUrl = await listen(createSmsCaptureServer({ config: buildConfig() }));

    const response = await fetch(`${baseUrl}/webhooks/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        MessageSid: "SM00000000000000000000000000000000",
        From: "+14065550142",
        To: "+14065550143",
        Body: "hello",
        NumMedia: "0",
      }),
    });

    expect(response.status).toBe(401);
  });

  it("updates the sms message row on a signed status callback", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);

    const seedTimestamp = new Date("2026-05-03T12:00:00.000Z");
    await context.settings.users.upsert({
      id: "user-1",
      name: "Test Operator",
      email: "operator@example.org",
      emailVerified: seedTimestamp,
      image: null,
      role: "operator",
      deactivatedAt: null,
      createdAt: seedTimestamp,
      updatedAt: seedTimestamp,
    });
    await context.repositories.contacts.upsert({
      id: "contact-1",
      salesforceContactId: null,
      displayName: "Volunteer One",
      primaryEmail: null,
      primaryPhone: "+14065550143",
      createdAt: seedTimestamp.toISOString(),
      updatedAt: seedTimestamp.toISOString(),
    });
    await context.db.insert(smsSenders).values({
      id: "sender-1",
      phoneE164: "+14065550142",
      displayName: "AS Test Sender",
      monthlyCap: null,
      isActive: true,
      createdAt: seedTimestamp,
      updatedAt: seedTimestamp,
    });

    await context.repositories.smsMessages.insert({
      id: "sms-message-1",
      twilioMessageSid: "SM00000000000000000000000000000000",
      direction: "outbound",
      contactId: "contact-1",
      phoneE164: "+14065550143",
      senderId: "sender-1",
      body: "hello",
      segments: 1,
      encoding: "GSM-7",
      mediaUrls: null,
      sendStatus: "sent",
      failedReason: null,
      failedDetail: null,
      sentAt: new Date("2026-05-03T12:00:00.000Z"),
      receivedAt: null,
      actorId: "user-1",
      createdAt: new Date("2026-05-03T12:00:00.000Z"),
      updatedAt: new Date("2026-05-03T12:00:00.000Z"),
    });

    const provider: TwilioProvider = {
      sendSms() {
        return Promise.resolve({
          messageSid: "SMignored",
          segments: 1,
        });
      },
      verifyWebhookSignature() {
        return true;
      },
      parseInbound() {
        return {
          messageSid: "SMignored",
          fromE164: "+14065550142",
          toE164: "+14065550143",
          body: "",
          numMediaUrls: 0,
          mediaUrls: [],
        };
      },
    };
    const baseUrl = await listen(
      createSmsCaptureServer({
        config: buildConfig(),
        provider,
        repositories: context.repositories,
      }),
    );

    const response = await fetch(`${baseUrl}/webhooks/status`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "signed",
      },
      body: new URLSearchParams({
        MessageSid: "SM00000000000000000000000000000000",
        MessageStatus: "delivered",
      }),
    });

    expect(response.status).toBe(200);
    await expect(
      context.repositories.smsMessages.findByTwilioSid(
        "SM00000000000000000000000000000000",
      ),
    ).resolves.toMatchObject({
      sendStatus: "delivered",
    });
  });
});
