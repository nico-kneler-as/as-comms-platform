import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const headersMock = vi.hoisted(() => vi.fn());
const createPostmarkClientMock = vi.hoisted(() => vi.fn());
const readWebEnvMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const requireSessionMock = vi.hoisted(() => vi.fn());
const sendBatchMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

vi.mock("@as-comms/integrations", () => ({
  createPostmarkClient: createPostmarkClientMock,
}));

vi.mock("@/src/server/env", () => ({
  readWebEnv: readWebEnvMock,
}));

vi.mock("@/src/server/auth/session", () => ({
  requireAdmin: requireAdminMock,
  requireSession: requireSessionMock,
}));

import { testSend } from "../../app/broadcasts/actions";
import {
  createOrgSenderForTests,
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function sessionUser() {
  return {
    id: "user:operator",
    email: "operator@example.org",
  };
}

async function seedUser(runtime: Stage1WebTestRuntime): Promise<void> {
  await runtime.context.settings.users.upsert({
    id: "user:operator",
    name: "Operator",
    email: "operator@example.org",
    emailVerified: new Date("2026-06-02T12:00:00.000Z"),
    image: null,
    role: "admin",
    deactivatedAt: null,
    createdAt: new Date("2026-06-02T12:00:00.000Z"),
    updatedAt: new Date("2026-06-02T12:00:00.000Z"),
  });
}

async function seedSelectedContact(
  runtime: Stage1WebTestRuntime,
  contactId: string,
): Promise<void> {
  await runtime.context.repositories.contacts.upsert({
    id: contactId,
    salesforceContactId: null,
    displayName: "Allie Example",
    primaryEmail: "allie@example.org",
    primaryPhone: null,
    createdAt: "2026-06-02T12:00:00.000Z",
    updatedAt: "2026-06-02T12:00:00.000Z",
  });
}

async function seedNewsletterRun(
  runtime: Stage1WebTestRuntime,
  input: {
    readonly launchType: "normal_email" | "html_email";
    readonly runId: string;
  },
): Promise<void> {
  await runtime.runtime.campaigns.campaignRuns.create({
    id: input.runId,
    kind: "newsletter",
    launchType: input.launchType,
    projectId: null,
    name: "Org sender test",
    fromEmail: "info@adventurescientists.org",
    fromName: null,
    replyToEmail: "info@adventurescientists.org",
    subjectTemplate: "Update for {{firstName}}",
    bodyDesignJson: null,
    bodyHtmlTemplate: "<p>Hello {{firstName}}</p>",
    bodyTextTemplate: "Hello {{firstName}}",
    preheader: "Preview text",
    audienceCriteria: {
      projectId: null,
      projectIds: [],
      statuses: [],
      contactIds: ["contact-1"],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: 1,
    createdByUserId: "user:operator",
    lastEditedByUserId: "user:operator",
  });
}

describe("campaign org-sender actions", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    headersMock.mockReset();
    createPostmarkClientMock.mockReset();
    readWebEnvMock.mockReset();
    requireAdminMock.mockReset();
    requireSessionMock.mockReset();
    sendBatchMock.mockReset();

    headersMock.mockResolvedValue(
      new Headers({
        origin: "http://localhost:3000",
      }),
    );
    readWebEnvMock.mockReturnValue({
      POSTMARK_SERVER_TOKEN: "server-token",
      POSTMARK_ACCOUNT_TOKEN: "account-token",
      POSTMARK_WEBHOOK_SIGNING_SECRET: "webhook-secret",
      POSTMARK_BASE_URL: null,
    });
    createPostmarkClientMock.mockReturnValue({
      sendBatch: sendBatchMock,
    });
    sendBatchMock.mockResolvedValue({ results: [] });
    requireAdminMock.mockResolvedValue(sessionUser());
    requireSessionMock.mockResolvedValue(sessionUser());

    runtime = await createStage1WebTestRuntime();
    await seedUser(runtime);
    await createOrgSenderForTests(runtime, {
      email: "info@adventurescientists.org",
      label: "Adventure Scientists",
    });
    await seedSelectedContact(runtime, "contact-1");
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it.each(["normal_email", "html_email"] as const)(
    "sends a %s test email from an enabled org sender",
    async (launchType) => {
      if (runtime === null) {
        throw new Error("Expected runtime.");
      }

      await seedNewsletterRun(runtime, {
        launchType,
        runId: `run-${launchType}`,
      });

      const result = await testSend(
        `run-${launchType}`,
        "recipient@example.org",
      );

      expect(result).toMatchObject({
        ok: true,
        data: {
          runId: `run-${launchType}`,
          recipientEmail: "recipient@example.org",
        },
      });
      expect(sendBatchMock).toHaveBeenCalledWith({
        messages: [
          expect.objectContaining({
            To: "recipient@example.org",
          }),
        ],
      });

      const firstBatchCall = sendBatchMock.mock.calls[0]?.[0] as
        | {
            readonly messages: readonly [{
              readonly From: string;
              readonly Metadata?: Record<string, string>;
            }];
          }
        | undefined;
      const sentMessage = firstBatchCall?.messages[0];
      expect(sentMessage?.From).toContain("info@adventurescientists.org");
      expect(sentMessage?.Metadata).toMatchObject({
        campaignRunId: `run-${launchType}`,
        campaignType: "test",
      });
    },
  );
});
