import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../app/api/webhooks/salesforce/route";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

type EnqueueAutomatedEmailSendJob = (input: {
  readonly runtime: unknown;
  readonly sendId: string;
}) => Promise<void>;

const enqueueAutomatedEmailSendJob = vi.hoisted(() =>
  vi.fn<EnqueueAutomatedEmailSendJob>(),
);

vi.mock("@/src/server/automated-email/enqueue", () => ({
  enqueueAutomatedEmailSendJob,
}));

const WEBHOOK_SECRET = "automated-email-test-secret";

function request(payload: unknown, secret = WEBHOOK_SECRET): Request {
  return new Request("http://localhost/api/webhooks/salesforce", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-automated-email-secret": secret,
    },
    body: JSON.stringify(payload),
  });
}

describe("Salesforce automated email webhook route", () => {
  let runtime: Stage1WebTestRuntime | null = null;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env.AUTOMATED_EMAIL_WEBHOOK_SECRET = WEBHOOK_SECRET;
    enqueueAutomatedEmailSendJob.mockReset();
    enqueueAutomatedEmailSendJob.mockResolvedValue(undefined);
    runtime = await createStage1WebTestRuntime();
    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project-automated-email",
      projectName: "Automated Email Project",
      source: "manual",
    });
  });

  afterEach(async () => {
    if (runtime !== null) {
      await runtime.dispose();
      runtime = null;
    }
    process.env = { ...originalEnv };
  });

  it("rejects a wrong shared secret", async () => {
    const response = await POST(
      request(
        {
          templateId: "00000000-0000-4000-8000-000000000001",
          expeditionMemberId: "a0B000000000001",
        },
        "wrong-secret",
      ),
    );

    expect(response.status).toBe(401);
    expect(enqueueAutomatedEmailSendJob).not.toHaveBeenCalled();
  });

  it("rejects malformed payloads", async () => {
    const response = await POST(
      request({
        templateId: "not-a-uuid",
        expeditionMemberId: "",
      }),
    );

    expect(response.status).toBe(400);
    expect(enqueueAutomatedEmailSendJob).not.toHaveBeenCalled();
  });

  it("accepts unknown templates without creating a send row", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    const response = await POST(
      request({
        templateId: "00000000-0000-4000-8000-000000000001",
        expeditionMemberId: "a0B000000000001",
      }),
    );

    expect(response.status).toBe(202);
    await expect(
      runtime.runtime.automatedEmails.listSendsByTemplate({
        templateId: "00000000-0000-4000-8000-000000000001",
        limit: 10,
      }),
    ).resolves.toMatchObject({ items: [] });
    expect(enqueueAutomatedEmailSendJob).not.toHaveBeenCalled();
  });

  it("creates a received send row and enqueues the send job for known templates", async () => {
    if (runtime === null) {
      throw new Error("Expected runtime.");
    }

    const template = await runtime.runtime.automatedEmails.createTemplate({
      projectId: "project-automated-email",
      name: "Application received",
      createdBy: null,
    });
    const payload = {
      templateId: template.id,
      expeditionMemberId: "a0B000000000001",
      firedAt: "2026-08-31T12:00:00.000Z",
      flowApiName: "ApplicationReceived",
    };

    const response = await POST(request(payload));

    expect(response.status).toBe(202);
    const enqueueCall = enqueueAutomatedEmailSendJob.mock.calls[0];
    if (enqueueCall === undefined) {
      throw new Error("Expected automated email job to be enqueued.");
    }
    const sendId = enqueueCall[0].sendId;
    const send = await runtime.runtime.automatedEmails.getSendLogRow(sendId);
    expect(send).toMatchObject({
      templateId: template.id,
      projectId: "project-automated-email",
      expeditionMemberId: payload.expeditionMemberId,
      status: "received",
      payload,
    });
    expect(enqueueAutomatedEmailSendJob).toHaveBeenCalledWith(
      expect.objectContaining({ sendId }),
    );
  });
});
