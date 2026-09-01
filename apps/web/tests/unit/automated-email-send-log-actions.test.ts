import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.hoisted(() => vi.fn());
const enqueueAutomatedEmailSendJob = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/src/server/auth/session", () => ({ requireSession }));

vi.mock("@/src/server/automated-email/enqueue", () => ({
  enqueueAutomatedEmailSendJob,
}));

import { sendAutomatedEmailNowAction } from "../../app/settings/projects/[projectId]/automated-emails/actions";
import { loadAutomatedEmailSendLogPage } from "../../src/server/automated-email/selectors";
import {
  createStage1WebTestRuntime,
  holdAutomatedEmailSendForTests,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

describe("automated email send log", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    requireSession.mockReset();
    enqueueAutomatedEmailSendJob.mockReset();
    requireSession.mockResolvedValue({ id: "user:operator" });
    enqueueAutomatedEmailSendJob.mockResolvedValue(undefined);
    runtime = await createStage1WebTestRuntime();
    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:automated-email-log",
      projectName: "Automated Email Log",
      source: "manual",
    });
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("resets a held row, clears processing metadata, and enqueues a fresh evaluation", async () => {
    if (runtime === null) throw new Error("Expected test runtime");
    const template = await runtime.runtime.automatedEmails.createTemplate({
      projectId: "project:automated-email-log",
      name: "Application received",
      createdBy: null,
    });
    const send = await runtime.runtime.automatedEmails.createSendLogRow({
      templateId: template.id,
      projectId: template.projectId,
      expeditionMemberId: "a0B000000000001",
      contactId: null,
      payload: { flow: "held" },
    });
    await holdAutomatedEmailSendForTests(runtime, send.id);

    const result = await sendAutomatedEmailNowAction({
      projectId: template.projectId,
      templateId: template.id,
      sendId: send.id,
    });

    expect(result).toMatchObject({
      ok: true,
      data: { id: send.id, status: "received" },
    });
    await expect(
      runtime.runtime.automatedEmails.getSendLogRow(send.id),
    ).resolves.toMatchObject({
      status: "received",
      statusReason: null,
      processedAt: null,
    });
    expect(enqueueAutomatedEmailSendJob).toHaveBeenCalledWith(
      expect.objectContaining({ sendId: send.id }),
    );
  });

  it("refuses a row that is not held without enqueueing it", async () => {
    if (runtime === null) throw new Error("Expected test runtime");
    const template = await runtime.runtime.automatedEmails.createTemplate({
      projectId: "project:automated-email-log",
      name: "Application received",
      createdBy: null,
    });
    const send = await runtime.runtime.automatedEmails.createSendLogRow({
      templateId: template.id,
      projectId: template.projectId,
      expeditionMemberId: "a0B000000000002",
      contactId: null,
      payload: {},
    });

    const result = await sendAutomatedEmailNowAction({
      projectId: template.projectId,
      templateId: template.id,
      sendId: send.id,
    });

    expect(result).toMatchObject({ ok: false, code: "send_not_held" });
    expect(enqueueAutomatedEmailSendJob).not.toHaveBeenCalled();
  });

  it("joins contact-backed rows while retaining contact-less expedition members", async () => {
    if (runtime === null) throw new Error("Expected test runtime");
    const template = await runtime.runtime.automatedEmails.createTemplate({
      projectId: "project:automated-email-log",
      name: "Application received",
      createdBy: null,
    });
    await runtime.context.repositories.contacts.upsert({
      id: "contact:send-log-member",
      salesforceContactId: null,
      displayName: "Riley Fieldworker",
      primaryEmail: "riley@example.org",
      primaryPhone: null,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
    });
    await runtime.runtime.automatedEmails.createSendLogRow({
      templateId: template.id,
      projectId: template.projectId,
      expeditionMemberId: "a0B000000000003",
      contactId: "contact:send-log-member",
      payload: {},
    });
    await runtime.runtime.automatedEmails.createSendLogRow({
      templateId: template.id,
      projectId: template.projectId,
      expeditionMemberId: "a0B000000000004",
      contactId: null,
      payload: {},
    });

    const page = await loadAutomatedEmailSendLogPage({
      projectId: template.projectId,
      templateId: template.id,
    });

    expect(page?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberName: "Riley Fieldworker",
          memberEmail: "riley@example.org",
        }),
        expect.objectContaining({
          memberName: "a0B000000000004",
          memberEmail: null,
        }),
      ]),
    );
  });
});
