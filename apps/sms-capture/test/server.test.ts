import type { Server } from "node:http";

import {
  canonicalEventLedger,
  consentRecords,
  contactIdentities,
  contactInboxProjection,
  contacts,
  identityResolutionQueue,
  smsMessages,
  smsSenders,
  sourceEvidenceLog,
} from "@as-comms/db";
import {
  createTestStage1Context,
  type TestStage1Context,
} from "@as-comms/db/test-helpers";
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

function buildProvider(input?: {
  readonly inbound?: ReturnType<TwilioProvider["parseInbound"]>;
}): TwilioProvider {
  return {
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
      return (
        input?.inbound ?? {
          messageSid: "SM00000000000000000000000000000000",
          fromE164: "+14065550143",
          toE164: "+14065550142",
          body: "hello from inbound",
          numMediaUrls: 0,
          mediaUrls: [],
        }
      );
    },
  };
}

async function createContext() {
  const context = await createTestStage1Context();
  contexts.push(context);
  return context;
}

async function seedSender(context: TestStage1Context) {
  const timestamp = new Date("2026-05-03T12:00:00.000Z");
  await context.db.insert(smsSenders).values({
    id: "sender-1",
    phoneE164: "+14065550142",
    displayName: "AS Test Sender",
    monthlyCap: null,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

async function seedContactWithPhoneIdentity(input: {
  readonly context: TestStage1Context;
  readonly contactId: string;
  readonly displayName: string;
  readonly phoneE164: string;
  readonly createdAt?: string;
}) {
  const createdAt = input.createdAt ?? "2026-05-03T12:00:00.000Z";
  await input.context.repositories.contacts.upsert({
    id: input.contactId,
    salesforceContactId: null,
    displayName: input.displayName,
    primaryEmail: null,
    primaryPhone: input.phoneE164,
    createdAt,
    updatedAt: createdAt,
  });
  await input.context.repositories.contactIdentities.upsert({
    id: `identity:${input.contactId}:phone`,
    contactId: input.contactId,
    kind: "phone",
    normalizedValue: input.phoneE164,
    isPrimary: true,
    source: "manual",
    verifiedAt: null,
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
    const context = await createContext();
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
    await seedSender(context);

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

    const baseUrl = await listen(
      createSmsCaptureServer({
        config: buildConfig(),
        provider: buildProvider(),
        db: context.db,
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

  it("creates a contact, inbound sms row, auto-consent, source evidence, canonical event, and inbox projection", async () => {
    const context = await createContext();
    await seedSender(context);
    const provider = buildProvider({
      inbound: {
        messageSid: "SMinbound-1",
        fromE164: "+14065550143",
        toE164: "+14065550142",
        body: "Need help with my trip",
        numMediaUrls: 0,
        mediaUrls: [],
      },
    });
    const baseUrl = await listen(
      createSmsCaptureServer({
        config: buildConfig(),
        provider,
        db: context.db,
      }),
    );

    const response = await fetch(`${baseUrl}/webhooks/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "signed",
      },
      body: new URLSearchParams({
        MessageSid: "SMinbound-1",
        From: "+14065550143",
        To: "+14065550142",
        Body: "Need help with my trip",
        NumMedia: "0",
      }),
    });

    expect(response.status).toBe(200);

    const contactRows = await context.db.select().from(contacts);
    expect(contactRows).toHaveLength(1);
    expect(contactRows[0]).toMatchObject({
      primaryPhone: "+14065550143",
      displayName: "Unknown (+1 406 555 0143)",
    });

    const smsRows = await context.db.select().from(smsMessages);
    expect(smsRows).toHaveLength(1);
    expect(smsRows[0]).toMatchObject({
      twilioMessageSid: "SMinbound-1",
      direction: "inbound",
      phoneE164: "+14065550143",
      body: "Need help with my trip",
      sendStatus: "received",
    });

    const consentRows = await context.db.select().from(consentRecords);
    expect(consentRows).toHaveLength(1);
    expect(consentRows[0]).toMatchObject({
      phoneE164: "+14065550143",
      status: "opted_in",
      source: "inbound_thread",
    });

    const sourceEvidenceRows = await context.db.select().from(sourceEvidenceLog);
    expect(sourceEvidenceRows).toHaveLength(1);
    expect(sourceEvidenceRows[0]).toMatchObject({
      provider: "twilio",
      providerRecordType: "message",
      providerRecordId: "SMinbound-1",
    });

    const canonicalRows = await context.db.select().from(canonicalEventLedger);
    expect(canonicalRows).toHaveLength(1);
    expect(canonicalRows[0]).toMatchObject({
      contactId: contactRows[0]?.id,
      eventType: "communication.sms.inbound",
      channel: "sms",
    });

    const projectionRows = await context.db.select().from(contactInboxProjection);
    expect(projectionRows).toHaveLength(1);
    expect(projectionRows[0]).toMatchObject({
      contactId: contactRows[0]?.id,
      bucket: "New",
      hasUnresolved: false,
      snippet: "Need help with my trip",
      lastCanonicalEventId: canonicalRows[0]?.id,
      lastEventType: "communication.sms.inbound",
    });

    const identityRows = await context.db.select().from(contactIdentities);
    expect(identityRows).toHaveLength(1);
    expect(identityRows[0]).toMatchObject({
      contactId: contactRows[0]?.id,
      kind: "phone",
      normalizedValue: "+14065550143",
      isPrimary: true,
    });
  });

  it("reuses an existing contact for signed inbound sms", async () => {
    const context = await createContext();
    await seedSender(context);
    await seedContactWithPhoneIdentity({
      context,
      contactId: "contact-existing",
      displayName: "Existing Contact",
      phoneE164: "+14065550143",
    });

    const baseUrl = await listen(
      createSmsCaptureServer({
        config: buildConfig(),
        provider: buildProvider({
          inbound: {
            messageSid: "SMinbound-existing",
            fromE164: "+14065550143",
            toE164: "+14065550142",
            body: "hello again",
            numMediaUrls: 0,
            mediaUrls: [],
          },
        }),
        db: context.db,
      }),
    );

    const response = await fetch(`${baseUrl}/webhooks/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "signed",
      },
      body: new URLSearchParams({
        MessageSid: "SMinbound-existing",
        From: "+14065550143",
        To: "+14065550142",
        Body: "hello again",
        NumMedia: "0",
      }),
    });

    expect(response.status).toBe(200);
    const contactRows = await context.db.select().from(contacts);
    expect(contactRows).toHaveLength(1);
    expect(contactRows[0]?.id).toBe("contact-existing");
  });

  it("tolerates inbound message sid retries without double-writing", async () => {
    const context = await createContext();
    await seedSender(context);
    const provider = buildProvider({
      inbound: {
        messageSid: "SMinbound-duplicate",
        fromE164: "+14065550143",
        toE164: "+14065550142",
        body: "retry me once",
        numMediaUrls: 0,
        mediaUrls: [],
      },
    });
    const baseUrl = await listen(
      createSmsCaptureServer({
        config: buildConfig(),
        provider,
        db: context.db,
      }),
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${baseUrl}/webhooks/inbound`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": "signed",
        },
        body: new URLSearchParams({
          MessageSid: "SMinbound-duplicate",
          From: "+14065550143",
          To: "+14065550142",
          Body: "retry me once",
          NumMedia: "0",
        }),
      });

      expect(response.status).toBe(200);
    }

    expect((await context.db.select().from(smsMessages)).length).toBe(1);
    expect((await context.db.select().from(sourceEvidenceLog)).length).toBe(1);
    expect((await context.db.select().from(canonicalEventLedger)).length).toBe(1);
  });

  it("returns 200 and skips writes for an unknown sender number", async () => {
    const context = await createContext();
    const baseUrl = await listen(
      createSmsCaptureServer({
        config: buildConfig(),
        provider: buildProvider({
          inbound: {
            messageSid: "SMinbound-unknown-sender",
            fromE164: "+14065550143",
            toE164: "+14065559999",
            body: "wrong route",
            numMediaUrls: 0,
            mediaUrls: [],
          },
        }),
        db: context.db,
      }),
    );

    const response = await fetch(`${baseUrl}/webhooks/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "signed",
      },
      body: new URLSearchParams({
        MessageSid: "SMinbound-unknown-sender",
        From: "+14065550143",
        To: "+14065559999",
        Body: "wrong route",
        NumMedia: "0",
      }),
    });

    expect(response.status).toBe(200);
    expect((await context.db.select().from(smsMessages)).length).toBe(0);
  });

  it("records STOP as revoked consent", async () => {
    const context = await createContext();
    await seedContactWithPhoneIdentity({
      context,
      contactId: "contact-stop",
      displayName: "Contact Stop",
      phoneE164: "+14065550143",
    });
    const baseUrl = await listen(
      createSmsCaptureServer({
        config: buildConfig(),
        provider: buildProvider(),
        db: context.db,
      }),
    );

    const response = await fetch(`${baseUrl}/webhooks/opt-out`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "signed",
      },
      body: new URLSearchParams({
        From: "+14065550143",
        OptOutType: "STOP",
      }),
    });

    expect(response.status).toBe(200);
    const consentRows = await context.db.select().from(consentRecords);
    expect(consentRows).toHaveLength(1);
    expect(consentRows[0]).toMatchObject({
      contactId: "contact-stop",
      phoneE164: "+14065550143",
      status: "revoked",
      source: "sms_reply_yes",
      sourceDetail: "STOP",
    });
  });

  it("opens an identity queue case for inbound sms when one phone matches multiple contacts", async () => {
    const context = await createContext();
    await seedSender(context);
    await seedContactWithPhoneIdentity({
      context,
      contactId: "contact-a",
      displayName: "Contact A",
      phoneE164: "+14065550143",
    });
    await seedContactWithPhoneIdentity({
      context,
      contactId: "contact-b",
      displayName: "Contact B",
      phoneE164: "+14065550143",
    });
    await context.repositories.inboxProjection.upsert({
      contactId: "contact-b",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-05-04T08:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-05-04T08:00:00.000Z",
      snippet: "Older inbound",
      archivedAt: null,
      lastCanonicalEventId: "event-existing",
      lastEventType: "communication.sms.inbound",
    });

    const baseUrl = await listen(
      createSmsCaptureServer({
        config: buildConfig(),
        provider: buildProvider({
          inbound: {
            messageSid: "SMinbound-ambiguous",
            fromE164: "+14065550143",
            toE164: "+14065550142",
            body: "which contact is this?",
            numMediaUrls: 0,
            mediaUrls: [],
          },
        }),
        db: context.db,
      }),
    );

    const response = await fetch(`${baseUrl}/webhooks/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "signed",
      },
      body: new URLSearchParams({
        MessageSid: "SMinbound-ambiguous",
        From: "+14065550143",
        To: "+14065550142",
        Body: "which contact is this?",
        NumMedia: "0",
      }),
    });

    expect(response.status).toBe(200);

    const smsRows = await context.db.select().from(smsMessages);
    expect(smsRows).toHaveLength(1);
    expect(smsRows[0]?.contactId).toBe("contact-b");

    const canonicalRows = await context.db.select().from(canonicalEventLedger);
    expect(canonicalRows).toHaveLength(1);
    expect(canonicalRows[0]).toMatchObject({
      contactId: "contact-b",
      reviewState: "needs_identity_review",
    });

    const projection = await context.repositories.inboxProjection.findByContactId(
      "contact-b",
    );
    expect(projection).toMatchObject({
      contactId: "contact-b",
      hasUnresolved: true,
    });

    const identityCases = await context.db.select().from(identityResolutionQueue);
    expect(identityCases).toHaveLength(1);
    expect(identityCases[0]).toMatchObject({
      sourceEvidenceId: canonicalRows[0]?.sourceEvidenceId,
      reasonCode: "identity_multi_candidate",
      anchoredContactId: "contact-b",
    });
    expect(identityCases[0]?.candidateContactIds).toEqual([
      "contact-a",
      "contact-b",
    ]);
  });

  it("falls back to alphabetical contact id for inbound sms ambiguity with no inbox activity", async () => {
    const context = await createContext();
    await seedSender(context);
    await seedContactWithPhoneIdentity({
      context,
      contactId: "contact-a",
      displayName: "Contact A",
      phoneE164: "+14065550143",
    });
    await seedContactWithPhoneIdentity({
      context,
      contactId: "contact-b",
      displayName: "Contact B",
      phoneE164: "+14065550143",
    });

    const baseUrl = await listen(
      createSmsCaptureServer({
        config: buildConfig(),
        provider: buildProvider({
          inbound: {
            messageSid: "SMinbound-alpha-fallback",
            fromE164: "+14065550143",
            toE164: "+14065550142",
            body: "alphabetical fallback",
            numMediaUrls: 0,
            mediaUrls: [],
          },
        }),
        db: context.db,
      }),
    );

    const response = await fetch(`${baseUrl}/webhooks/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "signed",
      },
      body: new URLSearchParams({
        MessageSid: "SMinbound-alpha-fallback",
        From: "+14065550143",
        To: "+14065550142",
        Body: "alphabetical fallback",
        NumMedia: "0",
      }),
    });

    expect(response.status).toBe(200);

    const smsRows = await context.db.select().from(smsMessages);
    expect(smsRows).toHaveLength(1);
    expect(smsRows[0]?.contactId).toBe("contact-a");

    const identityCases = await context.db.select().from(identityResolutionQueue);
    expect(identityCases).toHaveLength(1);
    expect(identityCases[0]).toMatchObject({
      reasonCode: "identity_multi_candidate",
      anchoredContactId: "contact-a",
    });
    expect(identityCases[0]?.candidateContactIds).toEqual([
      "contact-a",
      "contact-b",
    ]);
  });

  it("does not open an identity queue case for inbound sms when the phone matches one contact", async () => {
    const context = await createContext();
    await seedSender(context);
    await seedContactWithPhoneIdentity({
      context,
      contactId: "contact-single",
      displayName: "Single Contact",
      phoneE164: "+14065550143",
    });

    const baseUrl = await listen(
      createSmsCaptureServer({
        config: buildConfig(),
        provider: buildProvider({
          inbound: {
            messageSid: "SMinbound-single-match",
            fromE164: "+14065550143",
            toE164: "+14065550142",
            body: "single contact",
            numMediaUrls: 0,
            mediaUrls: [],
          },
        }),
        db: context.db,
      }),
    );

    const response = await fetch(`${baseUrl}/webhooks/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "signed",
      },
      body: new URLSearchParams({
        MessageSid: "SMinbound-single-match",
        From: "+14065550143",
        To: "+14065550142",
        Body: "single contact",
        NumMedia: "0",
      }),
    });

    expect(response.status).toBe(200);

    const canonicalRows = await context.db.select().from(canonicalEventLedger);
    expect(canonicalRows).toHaveLength(1);
    expect(canonicalRows[0]?.reviewState).toBe("clear");

    const projection = await context.repositories.inboxProjection.findByContactId(
      "contact-single",
    );
    expect(projection?.hasUnresolved).toBe(false);

    const identityCases = await context.db.select().from(identityResolutionQueue);
    expect(identityCases).toHaveLength(0);
  });

  it("treats HELP as a no-op", async () => {
    const context = await createContext();
    const baseUrl = await listen(
      createSmsCaptureServer({
        config: buildConfig(),
        provider: buildProvider(),
        db: context.db,
      }),
    );

    const response = await fetch(`${baseUrl}/webhooks/opt-out`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "signed",
      },
      body: new URLSearchParams({
        From: "+14065550143",
        OptOutType: "HELP",
      }),
    });

    expect(response.status).toBe(200);
    expect((await context.db.select().from(consentRecords)).length).toBe(0);
  });

  it("records START as re-consent", async () => {
    const context = await createContext();
    const baseUrl = await listen(
      createSmsCaptureServer({
        config: buildConfig(),
        provider: buildProvider(),
        db: context.db,
      }),
    );

    const response = await fetch(`${baseUrl}/webhooks/opt-out`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "signed",
      },
      body: new URLSearchParams({
        From: "+14065550143",
        OptOutType: "START",
      }),
    });

    expect(response.status).toBe(200);
    const consentRows = await context.db.select().from(consentRecords);
    expect(consentRows).toHaveLength(1);
    expect(consentRows[0]).toMatchObject({
      phoneE164: "+14065550143",
      status: "opted_in",
      source: "sms_reply_yes",
      sourceDetail: "START",
    });
  });
});
