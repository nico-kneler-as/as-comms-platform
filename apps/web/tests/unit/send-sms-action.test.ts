import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.hoisted(() => vi.fn());
const sendSmsViaTwilio = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
}));

vi.mock("@/src/server/auth/session", () => ({
  requireSession,
}));

vi.mock("@/src/server/composer/twilio-send", () => ({
  sendSmsViaTwilio,
}));

import { sendSmsAction, type SendSmsActionInput } from "../../app/inbox/actions";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function buildCurrentUser() {
  const now = new Date("2026-05-03T12:00:00.000Z");
  return {
    id: "user:operator",
    name: "Operator",
    email: "operator@example.org",
    emailVerified: now,
    image: null,
    role: "operator" as const,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildInput(
  overrides?: Partial<SendSmsActionInput>,
): SendSmsActionInput {
  return {
    recipient: {
      kind: "contact",
      contactId: "contact-1",
    },
    senderId: "sender-1",
    body: "Field update confirmed.",
    clientGeneratedId: "client-1",
    ...overrides,
  };
}

describe("sendSmsAction", () => {
  let runtime: Stage1WebTestRuntime | null = null;
  const originalSmsEnabled = process.env.SMS_ENABLED;

  beforeEach(async () => {
    requireSession.mockReset();
    sendSmsViaTwilio.mockReset();
    requireSession.mockResolvedValue(buildCurrentUser());
    process.env.SMS_ENABLED = "true";
    runtime = await createStage1WebTestRuntime();
    await runtime.context.settings.users.upsert(buildCurrentUser());
    const now = new Date("2026-05-03T12:00:00.000Z");
    await runtime.context.repositories.contacts.upsert({
      id: "contact-1",
      salesforceContactId: null,
      displayName: "Maya Lee",
      primaryEmail: null,
      primaryPhone: "+14065550123",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await runtime.context.repositories.contactIdentities.upsert({
      id: "identity:contact-1:phone",
      contactId: "contact-1",
      kind: "phone",
      normalizedValue: "+14065550123",
      isPrimary: true,
      source: "manual",
      verifiedAt: now.toISOString(),
    });
    await runtime.context.client.exec(`
      insert into sms_senders (
        id,
        phone_e164,
        display_name,
        monthly_cap,
        is_active,
        created_at,
        updated_at
      ) values (
        'sender-1',
        '+14065550142',
        'Adventure Scientists',
        null,
        true,
        '${now.toISOString()}',
        '${now.toISOString()}'
      );
    `);
  });

  afterEach(async () => {
    if (originalSmsEnabled === undefined) {
      delete process.env.SMS_ENABLED;
    } else {
      process.env.SMS_ENABLED = originalSmsEnabled;
    }
    await runtime?.dispose();
    runtime = null;
  });

  it("returns feature_disabled when the flag is off", async () => {
    process.env.SMS_ENABLED = "false";

    const result = await sendSmsAction(buildInput());

    expect(result).toEqual({
      ok: false,
      code: "feature_disabled",
      message: "SMS is not enabled.",
    });
  });

  it("returns consent_denied without prior consent or inbound", async () => {
    const result = await sendSmsAction(buildInput());

    expect(result).toEqual({
      ok: false,
      code: "consent_denied",
      message: "This recipient has not opted in to SMS.",
      retryable: false,
    });
  });

  it("returns validation_error when the body exceeds 10 segments", async () => {
    await runtime?.context.repositories.consentRecords.insert({
      id: "consent-1",
      contactId: "contact-1",
      phoneE164: "+14065550123",
      status: "opted_in",
      source: "operator_attestation",
      sourceDetail: null,
      consentedAt: new Date("2026-05-03T12:00:00.000Z"),
      revokedAt: null,
      recordedByUserId: "user:operator",
      notes: null,
      createdAt: new Date("2026-05-03T12:00:00.000Z"),
      updatedAt: new Date("2026-05-03T12:00:00.000Z"),
    });

    const result = await sendSmsAction({
      ...buildInput(),
      body: "a".repeat(1601),
    });

    expect(result).toEqual({
      ok: false,
      code: "validation_error",
      message: "SMS messages are limited to 10 segments.",
      retryable: false,
    });
  });

  it("marks the row failed and returns twilio_error when Twilio send fails", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    await runtime.context.repositories.consentRecords.insert({
      id: "consent-2",
      contactId: "contact-1",
      phoneE164: "+14065550123",
      status: "opted_in",
      source: "operator_attestation",
      sourceDetail: null,
      consentedAt: new Date("2026-05-03T12:00:00.000Z"),
      revokedAt: null,
      recordedByUserId: "user:operator",
      notes: null,
      createdAt: new Date("2026-05-03T12:00:00.000Z"),
      updatedAt: new Date("2026-05-03T12:00:00.000Z"),
    });
    sendSmsViaTwilio.mockRejectedValue(new Error("twilio down"));

    const result = await sendSmsAction(buildInput());

    expect(result).toEqual({
      ok: false,
      code: "twilio_error",
      message: "SMS sending failed.",
      retryable: true,
    });
    const rows = await runtime.context.repositories.smsMessages.listByContact(
      "contact-1",
      10,
    );
    expect(rows[0]).toMatchObject({
      sendStatus: "failed",
      failedReason: "twilio_send_failed",
    });
  });

  it("succeeds and stores the Twilio sid", async () => {
    if (!runtime) {
      throw new Error("Expected runtime.");
    }

    await runtime.context.repositories.consentRecords.insert({
      id: "consent-3",
      contactId: "contact-1",
      phoneE164: "+14065550123",
      status: "opted_in",
      source: "operator_attestation",
      sourceDetail: null,
      consentedAt: new Date("2026-05-03T12:00:00.000Z"),
      revokedAt: null,
      recordedByUserId: "user:operator",
      notes: null,
      createdAt: new Date("2026-05-03T12:00:00.000Z"),
      updatedAt: new Date("2026-05-03T12:00:00.000Z"),
    });
    sendSmsViaTwilio.mockResolvedValue({
      messageSid: "SM123",
      segments: 1,
    });

    const result = await sendSmsAction(buildInput());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected success result.");
    }
    expect(typeof result.data.messageId).toBe("string");
    expect(result.data.clientGeneratedId).toBe("client-1");
    const rows = await runtime.context.repositories.smsMessages.listByContact(
      "contact-1",
      10,
    );
    expect(rows[0]).toMatchObject({
      twilioMessageSid: "SM123",
      sendStatus: "sent",
    });
  });
});
