import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSendLogRow,
  createTemplate,
  getSendLogRow,
  publishTemplate,
  setTemplateActive,
  updateSendStatus,
} from "@as-comms/db";

import {
  createAutomatedEmailSendTask,
  createAutomatedEmailSendTaskDependencies,
} from "../src/jobs/send-automated-email/index.js";
import { createTestStage1Context } from "./helpers.js";

type Stage1Context = Awaited<ReturnType<typeof createTestStage1Context>>;

const NOW = new Date("2026-08-31T12:00:00.000Z");
const EXPEDITION_MEMBER_ID = "a0B000000000001";
const LOCAL_CONTACT_ID = "003000000000000001";

function documentBody() {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Hello " },
          { type: "mergeField", attrs: { key: "firstName" } },
          { type: "text", text: ", welcome aboard." },
        ],
      },
    ],
  };
}

function createSalesforceClient(input?: {
  readonly contactId?: string | null;
  readonly email?: string | null;
  readonly rows?: readonly Record<string, unknown>[];
}) {
  return {
    queryAll: vi.fn().mockResolvedValue(
      input?.rows ?? [
        {
          Contact__c: input?.contactId ?? LOCAL_CONTACT_ID,
          Contact__r: {
            FirstName: "Ada",
            LastName: "Lovelace",
            Email: input?.email === undefined ? "ada@example.org" : input.email,
          },
          Expedition__r: { Name: "Project Atlas" },
        },
      ],
    ),
  };
}

function createPostmarkClient() {
  return {
    sendBatch: vi.fn().mockResolvedValue({
      results: [
        {
          ErrorCode: 0,
          Message: "OK",
          MessageID: "postmark-message-1",
          SubmittedAt: "2026-08-31T12:01:00.000Z",
          To: "ada@example.org",
        },
      ],
    }),
  };
}

function createOpsAlert() {
  return {
    send: vi.fn().mockResolvedValue({
      kind: "sent",
      gmailMessageId: "ops-alert-1",
    }),
  };
}

async function seedProject(context: Stage1Context, includeAlias = true) {
  await context.repositories.projectDimensions.upsert({
    projectId: "project-automated-email",
    projectName: "Project Atlas",
    source: "manual",
  });

  if (includeAlias) {
    await context.settings.aliases.create({
      id: "alias-automated-email",
      alias: "atlas@adventurescientists.org",
      signature: "",
      projectId: "project-automated-email",
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: null,
      updatedBy: null,
    });
  }
}

async function seedTemplate(
  context: Stage1Context,
  input: { readonly active: boolean; readonly published?: boolean },
) {
  const template = await createTemplate(context.db, {
    projectId: "project-automated-email",
    name: "Application received",
    draftSubject: "Welcome {{firstName}}",
    draftDoc: documentBody(),
    createdBy: null,
  });

  if (input.published ?? true) {
    await publishTemplate(context.db, template.id, null);
  }

  return setTemplateActive(context.db, template.id, input.active);
}

async function seedSend(context: Stage1Context, templateId: string) {
  return createSendLogRow(context.db, {
    templateId,
    projectId: "project-automated-email",
    expeditionMemberId: EXPEDITION_MEMBER_ID,
    contactId: null,
    payload: {
      templateId,
      expeditionMemberId: EXPEDITION_MEMBER_ID,
    },
  });
}

async function seedLocalContact(context: Stage1Context) {
  await context.repositories.contacts.upsert({
    id: LOCAL_CONTACT_ID,
    salesforceContactId: LOCAL_CONTACT_ID,
    displayName: "Ada Lovelace",
    primaryEmail: "ada@example.org",
    primaryPhone: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
}

function createTask(
  context: Stage1Context,
  input: {
    readonly salesforceClient: ReturnType<typeof createSalesforceClient> | null;
    readonly postmarkClient?: ReturnType<typeof createPostmarkClient> | null;
    readonly opsAlert?: ReturnType<typeof createOpsAlert>;
  },
) {
  const opsAlert = input.opsAlert ?? createOpsAlert();
  const task = createAutomatedEmailSendTask(
    createAutomatedEmailSendTaskDependencies({
      db: context.db,
      persistence: context.persistence,
      contacts: context.repositories.contacts,
      projects: context.settings.projects,
      salesforceClient: input.salesforceClient,
      postmarkClient: input.postmarkClient ?? createPostmarkClient(),
      opsAlert,
      now: () => NOW,
    }),
  );

  return { task, opsAlert };
}

describe("send-automated-email task", () => {
  let context: Stage1Context | null = null;

  beforeEach(async () => {
    context = await createTestStage1Context();
    await seedProject(context);
  });

  afterEach(async () => {
    await context?.dispose();
    context = null;
  });

  it("short-circuits a recent successful duplicate", async () => {
    if (context === null) {
      throw new Error("Expected test context.");
    }

    const template = await seedTemplate(context, { active: true });
    const previous = await seedSend(context, template.id);
    await updateSendStatus(context.db, previous.id, {
      status: "sent",
      providerMessageId: "postmark-previous",
    });
    const send = await seedSend(context, template.id);
    const { task, opsAlert } = createTask(context, {
      salesforceClient: null,
      postmarkClient: null,
    });

    await task({ sendId: send.id }, {} as never);

    await expect(getSendLogRow(context.db, send.id)).resolves.toMatchObject({
      status: "duplicate",
      statusReason: "duplicate_recent_send",
    });
    expect(opsAlert.send).not.toHaveBeenCalled();
  });

  it("renders inactive templates into a held dry-run preview without sending", async () => {
    if (context === null) {
      throw new Error("Expected test context.");
    }

    const template = await seedTemplate(context, { active: false });
    const send = await seedSend(context, template.id);
    const postmarkClient = createPostmarkClient();
    const { task, opsAlert } = createTask(context, {
      salesforceClient: createSalesforceClient(),
      postmarkClient,
    });

    await task({ sendId: send.id }, {} as never);

    const processed = await getSendLogRow(context.db, send.id);
    expect(processed).toMatchObject({
      status: "held",
      statusReason: "inactive_dry_run",
    });
    const renderedPreview = processed?.renderedPreview;
    if (renderedPreview === null || renderedPreview === undefined) {
      throw new Error("Expected inactive dry-run preview.");
    }
    expect(renderedPreview.subject).toBe("Welcome Ada");
    expect(renderedPreview.text).toContain("Hello Ada");
    expect(postmarkClient.sendBatch).not.toHaveBeenCalled();
    expect(opsAlert.send).not.toHaveBeenCalled();
  });

  it("holds active templates without a published snapshot and alerts", async () => {
    if (context === null) {
      throw new Error("Expected test context.");
    }

    const template = await seedTemplate(context, {
      active: true,
      published: false,
    });
    const send = await seedSend(context, template.id);
    const { task, opsAlert } = createTask(context, {
      salesforceClient: createSalesforceClient(),
      postmarkClient: null,
    });

    await task({ sendId: send.id }, {} as never);

    await expect(getSendLogRow(context.db, send.id)).resolves.toMatchObject({
      status: "held",
      statusReason: "no_published_copy",
    });
    expect(opsAlert.send).toHaveBeenCalledTimes(1);
  });

  it("holds unresolved required merge values and alerts", async () => {
    if (context === null) {
      throw new Error("Expected test context.");
    }

    const template = await seedTemplate(context, { active: true });
    const send = await seedSend(context, template.id);
    const { task, opsAlert } = createTask(context, {
      salesforceClient: createSalesforceClient({ email: null }),
      postmarkClient: null,
    });

    await task({ sendId: send.id }, {} as never);

    await expect(getSendLogRow(context.db, send.id)).resolves.toMatchObject({
      status: "held",
      statusReason: "missing_required:email",
    });
    expect(opsAlert.send).toHaveBeenCalledTimes(1);
  });

  it("fails Salesforce not-found resolutions and alerts", async () => {
    if (context === null) {
      throw new Error("Expected test context.");
    }

    const template = await seedTemplate(context, { active: true });
    const send = await seedSend(context, template.id);
    const { task, opsAlert } = createTask(context, {
      salesforceClient: createSalesforceClient({ rows: [] }),
      postmarkClient: null,
    });

    await task({ sendId: send.id }, {} as never);

    await expect(getSendLogRow(context.db, send.id)).resolves.toMatchObject({
      status: "failed",
      statusReason: "not_found",
    });
    expect(opsAlert.send).toHaveBeenCalledTimes(1);
  });

  it("sends, persists a local-contact ledger event, and remains idempotent", async () => {
    if (context === null) {
      throw new Error("Expected test context.");
    }

    await seedLocalContact(context);
    const template = await seedTemplate(context, { active: true });
    const send = await seedSend(context, template.id);
    const postmarkClient = createPostmarkClient();
    const { task } = createTask(context, {
      salesforceClient: createSalesforceClient(),
      postmarkClient,
    });

    await task({ sendId: send.id }, {} as never);

    const processed = await getSendLogRow(context.db, send.id);
    expect(processed).toMatchObject({
      status: "sent",
      contactId: LOCAL_CONTACT_ID,
      providerMessageId: "postmark-message-1",
    });
    const ledgerEventId = processed?.ledgerEventId;
    const renderedPreview = processed?.renderedPreview;
    if (!ledgerEventId || !renderedPreview) {
      throw new Error("Expected a ledger event and rendered preview.");
    }
    expect(renderedPreview.subject).toBe("Welcome Ada");
    expect(renderedPreview.html).toContain("Hello Ada");
    const event =
      await context.repositories.canonicalEvents.findById(ledgerEventId);
    expect(event).toMatchObject({
      contactId: LOCAL_CONTACT_ID,
      eventType: "automated.email.sent",
      provenance: {
        campaignRef: { providerMessageName: "Welcome Ada" },
      },
    });
    expect(JSON.stringify(event)).not.toContain("Hello Ada");

    await task({ sendId: send.id }, {} as never);
    expect(postmarkClient.sendBatch).toHaveBeenCalledTimes(1);
  });

  it("sends without a ledger event when Salesforce contact has no local match", async () => {
    if (context === null) {
      throw new Error("Expected test context.");
    }

    const template = await seedTemplate(context, { active: true });
    const send = await seedSend(context, template.id);
    const { task } = createTask(context, {
      salesforceClient: createSalesforceClient({
        contactId: "003000000000000002",
      }),
    });

    await task({ sendId: send.id }, {} as never);

    await expect(getSendLogRow(context.db, send.id)).resolves.toMatchObject({
      status: "sent",
      providerMessageId: "postmark-message-1",
      ledgerEventId: null,
      contactId: null,
    });
    await expect(context.repositories.canonicalEvents.countAll()).resolves.toBe(
      0,
    );
  });

  it("fails cleanly when direct Salesforce credentials are absent", async () => {
    if (context === null) {
      throw new Error("Expected test context.");
    }

    const template = await seedTemplate(context, { active: true });
    const send = await seedSend(context, template.id);
    const { task, opsAlert } = createTask(context, {
      salesforceClient: null,
      postmarkClient: null,
    });

    await task({ sendId: send.id }, {} as never);

    await expect(getSendLogRow(context.db, send.id)).resolves.toMatchObject({
      status: "failed",
      statusReason: "salesforce_not_configured",
    });
    expect(opsAlert.send).toHaveBeenCalledTimes(1);
  });
});
