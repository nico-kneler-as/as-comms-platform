import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const headersMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const requireSessionMock = vi.hoisted(() => vi.fn());
const sendSmsViaTwilioMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

vi.mock("@/src/server/auth/session", () => ({
  requireAdmin: requireAdminMock,
  requireSession: requireSessionMock,
}));

vi.mock("@/src/server/composer/twilio-send", () => ({
  sendSmsViaTwilio: sendSmsViaTwilioMock,
}));

import { renderSmsBroadcast } from "@as-comms/domain";

import { sendSmsBroadcastTest } from "../../app/broadcasts/actions";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function sessionUser() {
  return {
    id: "user:admin",
    email: "admin@example.org",
  };
}

async function seedUser(runtime: Stage1WebTestRuntime): Promise<void> {
  const now = new Date("2026-07-02T12:00:00.000Z");
  await runtime.context.settings.users.upsert({
    id: "user:admin",
    name: "Admin User",
    email: "admin@example.org",
    emailVerified: now,
    image: null,
    role: "admin",
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedSmsBroadcastRun(
  runtime: Stage1WebTestRuntime,
  input?: {
    readonly id?: string;
    readonly launchType?: "sms" | "normal_email";
    readonly bodyTextTemplate?: string | null;
  },
): Promise<string> {
  const runId = input?.id ?? "run-sms-test";
  await runtime.runtime.campaigns.campaignRuns.create({
    id: runId,
    kind: "project",
    launchType: input?.launchType ?? "sms",
    projectId: null,
    name: "SMS test",
    fromEmail: null,
    fromName: null,
    replyToEmail: null,
    subjectTemplate: null,
    bodyDesignJson: null,
    bodyHtmlTemplate: null,
    bodyTextTemplate: input?.bodyTextTemplate ?? "Hello {{firstName}}",
    preheader: null,
    audienceCriteria: {
      projectId: null,
      projectIds: [],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: null,
    createdByUserId: "user:admin",
    lastEditedByUserId: "user:admin",
  });

  return runId;
}

describe("sendSmsBroadcastTest", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    headersMock.mockReset();
    requireAdminMock.mockReset();
    requireSessionMock.mockReset();
    sendSmsViaTwilioMock.mockReset();

    headersMock.mockResolvedValue(new Headers());
    requireAdminMock.mockResolvedValue(sessionUser());
    requireSessionMock.mockResolvedValue(sessionUser());

    runtime = await createStage1WebTestRuntime();
    await seedUser(runtime);
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("renders the SMS body and sends one test message to the normalized number", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    const runId = await seedSmsBroadcastRun(runtime, {
      bodyTextTemplate: "Hello {{firstName}}",
    });
    sendSmsViaTwilioMock.mockResolvedValue({
      messageSid: "SM-test",
      segments: 2,
    });

    const result = await sendSmsBroadcastTest({
      runId,
      toPhoneE164: "(406) 555-0123",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected success result.");
    }
    expect(result.data).toEqual({
      segments: 2,
    });
    expect(result.requestId).toEqual(expect.any(String));
    expect(sendSmsViaTwilioMock).toHaveBeenCalledTimes(1);
    expect(sendSmsViaTwilioMock).toHaveBeenCalledWith({
      toE164: "+14065550123",
      body: renderSmsBroadcast({
        template: "Hello {{firstName}}",
        context: {
          firstName: null,
          email: null,
        },
      }).body,
    });
  });

  it("returns a typed validation error for an unparsable phone number", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    const runId = await seedSmsBroadcastRun(runtime);

    const result = await sendSmsBroadcastTest({
      runId,
      toPhoneE164: "not a phone",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result.");
    }
    expect(result.code).toBe("campaign_sms_test_invalid_phone");
    expect(result.message).toBe("Enter a valid phone number.");
    expect(result.requestId).toEqual(expect.any(String));
    expect(sendSmsViaTwilioMock).not.toHaveBeenCalled();
  });

  it("surfaces the Twilio rejection message", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    const runId = await seedSmsBroadcastRun(runtime);
    sendSmsViaTwilioMock.mockRejectedValue(
      new Error("A US 10DLC sender cannot send to this destination."),
    );

    const result = await sendSmsBroadcastTest({
      runId,
      toPhoneE164: "+61412345678",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected error result.");
    }
    expect(result.code).toBe("campaign_sms_test_send_failed");
    expect(result.message).toBe(
      "A US 10DLC sender cannot send to this destination.",
    );
    expect(result.requestId).toEqual(expect.any(String));
    expect(sendSmsViaTwilioMock).toHaveBeenCalledTimes(1);
  });
});
