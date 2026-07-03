import { createRequire } from "node:module";

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const saveCampaignWizardDraftActionMock = vi.hoisted(() => vi.fn());
const resolveAudienceCountActionMock = vi.hoisted(() => vi.fn());
const previewAudienceActionMock = vi.hoisted(() => vi.fn());
const loadComposePreviewActionMock = vi.hoisted(() => vi.fn());
const loadSelectedAliasSignatureActionMock = vi.hoisted(() => vi.fn());
const loadMemberStatusCountsForProjectsMock = vi.hoisted(() => vi.fn());
const searchNewsletterSubscribersActionMock = vi.hoisted(() => vi.fn());
const searchProjectVolunteersActionMock = vi.hoisted(() => vi.fn());
const previewSmsBroadcastMock = vi.hoisted(() => vi.fn());
const testSendMock = vi.hoisted(() => vi.fn());
const scheduleMock = vi.hoisted(() => vi.fn());
const sendNowMock = vi.hoisted(() => vi.fn());
const sendSmsBroadcastNowMock = vi.hoisted(() => vi.fn());
const sendSmsBroadcastTestMock = vi.hoisted(() => vi.fn());

vi.mock("../../app/broadcasts/_lib/audience-data-source", () => ({
  loadComposePreviewAction: loadComposePreviewActionMock,
  loadMemberStatusCountsForProjects: loadMemberStatusCountsForProjectsMock,
  loadSelectedAliasSignatureAction: loadSelectedAliasSignatureActionMock,
  previewAudienceAction: previewAudienceActionMock,
  resolveAudienceCountAction: resolveAudienceCountActionMock,
  saveCampaignWizardDraftAction: saveCampaignWizardDraftActionMock,
  searchNewsletterSubscribersAction: searchNewsletterSubscribersActionMock,
  searchProjectVolunteersAction: searchProjectVolunteersActionMock,
}));

vi.mock("../../app/broadcasts/actions", () => ({
  previewSmsBroadcast: previewSmsBroadcastMock,
  schedule: scheduleMock,
  sendNow: sendNowMock,
  sendSmsBroadcastNow: sendSmsBroadcastNowMock,
  sendSmsBroadcastTest: sendSmsBroadcastTestMock,
  testSend: testSendMock,
}));

vi.mock("../../app/broadcasts/new/_components/launch-type-step", () => ({
  LaunchTypeStep: ({
    onChange,
    onContinue,
    value,
  }: {
    readonly onChange: (value: "normal_email" | "html_email" | "sms") => void;
    readonly onContinue: () => void;
    readonly value: string;
  }) => (
    <section data-testid="launch-step">
      <div>LaunchTypeStep</div>
      <div data-testid="launch-value">{value}</div>
      <button
        type="button"
        aria-label="set-launch-normal"
        onClick={() => {
          onChange("normal_email");
        }}
      >
        Set normal
      </button>
      <button
        type="button"
        aria-label="set-launch-html"
        onClick={() => {
          onChange("html_email");
        }}
      >
        Set html
      </button>
      <button
        type="button"
        aria-label="set-launch-sms"
        onClick={() => {
          onChange("sms");
        }}
      >
        Set sms
      </button>
      <button type="button" aria-label="launch-continue" onClick={onContinue}>
        Continue
      </button>
    </section>
  ),
}));

vi.mock("../../app/broadcasts/new/_components/name-and-sender-step", () => ({
  NameAndSenderStep: ({
    fromEmail,
    name,
    onBack,
    onContinue,
    onFromEmailChange,
    onNameChange,
    senderOptions,
  }: {
    readonly fromEmail: string | null;
    readonly name: string;
    readonly onBack: () => void;
    readonly onContinue: () => void;
    readonly onFromEmailChange: (value: string | null) => void;
    readonly onNameChange: (value: string) => void;
    readonly senderOptions: readonly {
      readonly email: string;
    }[];
  }) => (
    <section data-testid="name-sender-step">
      <div>NameAndSenderStep</div>
      <div data-testid="current-from-email">{fromEmail ?? "none"}</div>
      <input
        aria-label="campaign-name"
        value={name}
        onChange={(event) => {
          onNameChange(event.currentTarget.value);
        }}
      />
      {senderOptions.map((option) => (
        <button
          key={option.email}
          type="button"
          aria-label={`sender-${option.email}`}
          onClick={() => {
            onFromEmailChange(option.email);
          }}
        >
          {option.email}
        </button>
      ))}
      <button type="button" aria-label="name-back" onClick={onBack}>
        Back
      </button>
      <button type="button" aria-label="name-continue" onClick={onContinue}>
        Continue
      </button>
    </section>
  ),
}));

vi.mock("../../app/broadcasts/new/_components/audience-builder-step", () => ({
  AudienceBuilderStep: ({
    availableModes,
    criteria,
    onBack,
    onContinue,
    onInitialFilterChange,
    onVolunteerSearchQueryChange,
    onVolunteerToggle,
    previewRows,
    volunteerSearchQuery,
    volunteerSearchRows,
  }: {
    readonly availableModes: readonly (
      | "project_status"
      | "specific"
      | "all_approved"
      | "all_available"
    )[];
    readonly criteria: {
      readonly initialFilter?:
        | "project_status"
        | "specific"
        | "all_approved"
        | "all_available";
    };
    readonly onBack: () => void;
    readonly onContinue: () => void;
    readonly onInitialFilterChange: (
      value: "project_status" | "specific" | "all_approved" | "all_available",
    ) => void;
    readonly onVolunteerSearchQueryChange: (value: string) => void;
    readonly onVolunteerToggle: (id: string) => void;
    readonly previewRows: readonly {
      readonly contactId: string;
      readonly name: string;
    }[];
    readonly volunteerSearchQuery: string;
    readonly volunteerSearchRows: readonly (
      | {
          readonly contactId: string;
          readonly name: string;
        }
      | {
          readonly subscriberId: string;
          readonly firstName: string | null;
          readonly email: string;
        }
    )[];
  }) => (
    <section data-testid="audience-step">
      <div>AudienceBuilderStep</div>
      <div data-testid="audience-mode">{criteria.initialFilter ?? "unset"}</div>
      <div data-testid="audience-available-modes">
        {availableModes.join(",")}
      </div>
      <input
        aria-label="volunteer-search"
        value={volunteerSearchQuery}
        onChange={(event) => {
          onVolunteerSearchQueryChange(event.currentTarget.value);
        }}
      />
      {availableModes.includes("specific") ? (
        <button
          type="button"
          aria-label="mode-specific"
          onClick={() => {
            onInitialFilterChange("specific");
          }}
        >
          Specific
        </button>
      ) : null}
      {availableModes.includes("project_status") ? (
        <button
          type="button"
          aria-label="mode-project-status"
          onClick={() => {
            onInitialFilterChange("project_status");
          }}
        >
          Project status
        </button>
      ) : null}
      {availableModes.includes("all_approved") ? (
        <button
          type="button"
          aria-label="mode-all-approved"
          onClick={() => {
            onInitialFilterChange("all_approved");
          }}
        >
          All approved
        </button>
      ) : null}
      {availableModes.includes("all_available") ? (
        <button
          type="button"
          aria-label="mode-all-available"
          onClick={() => {
            onInitialFilterChange("all_available");
          }}
        >
          All available
        </button>
      ) : null}
      <button
        type="button"
        aria-label="search-alice"
        onClick={() => {
          onVolunteerSearchQueryChange("alice");
        }}
      >
        Search Alice
      </button>
      <div data-testid="preview-row-count">{String(previewRows.length)}</div>
      <ul data-testid="volunteer-rows">
        {volunteerSearchRows.map((row) => {
          const rowId = "contactId" in row ? row.contactId : row.subscriberId;
          const label =
            "contactId" in row ? row.name : (row.firstName ?? row.email);

          return (
            <li key={rowId}>
              {label}
              <button
                type="button"
                aria-label={`toggle-row-${rowId}`}
                onClick={() => {
                  onVolunteerToggle(rowId);
                }}
              >
                Toggle
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" aria-label="audience-back" onClick={onBack}>
        Back
      </button>
      <button type="button" aria-label="audience-continue" onClick={onContinue}>
        Continue
      </button>
    </section>
  ),
}));

vi.mock("../../app/broadcasts/new/_components/compose-step", () => ({
  ComposeStep: ({
    onBack,
    onContinue,
    onSubjectChange,
    selectedAliasSignature,
    subject,
  }: {
    readonly onBack: () => void;
    readonly onContinue: () => void;
    readonly onSubjectChange: (value: string) => void;
    readonly selectedAliasSignature: string;
    readonly subject: string;
  }) => (
    <section data-testid="compose-step">
      <div>ComposeStep</div>
      <div data-testid="compose-signature">{selectedAliasSignature}</div>
      <input
        aria-label="broadcast-subject"
        value={subject}
        onChange={(event) => {
          onSubjectChange(event.currentTarget.value);
        }}
      />
      <button
        type="button"
        aria-label="set-subject-updated"
        onClick={() => {
          onSubjectChange("Updated subject line");
        }}
      >
        Set subject
      </button>
      <button type="button" aria-label="compose-back" onClick={onBack}>
        Back
      </button>
      <button type="button" aria-label="compose-continue" onClick={onContinue}>
        Continue
      </button>
    </section>
  ),
}));

vi.mock("../../app/broadcasts/new/_components/preview-step", () => ({
  PreviewStep: ({
    launchType,
    onBack,
    onContinue,
    onSendTest,
    onTestRecipientValueChange,
    testRecipientValue,
  }: {
    readonly launchType: string;
    readonly onBack: () => void;
    readonly onContinue: () => void;
    readonly onSendTest: () => void;
    readonly onTestRecipientValueChange: (value: string) => void;
    readonly testRecipientValue: string;
  }) => (
    <section data-testid="preview-step">
      <div>PreviewStep</div>
      <div data-testid="preview-launch-type">{launchType}</div>
      <input
        aria-label="preview-test-recipient"
        value={testRecipientValue}
        onChange={(event) => {
          onTestRecipientValueChange(event.currentTarget.value);
        }}
      />
      <button
        type="button"
        aria-label="set-preview-test-recipient"
        onClick={() => {
          onTestRecipientValueChange("+14065550123");
        }}
      >
        Set preview recipient
      </button>
      <button type="button" aria-label="preview-send-test" onClick={onSendTest}>
        Send test
      </button>
      <button type="button" aria-label="preview-back" onClick={onBack}>
        Back
      </button>
      <button type="button" aria-label="preview-continue" onClick={onContinue}>
        Continue
      </button>
    </section>
  ),
}));

vi.mock("../../app/broadcasts/new/_components/review-step", () => ({
  ReviewStep: ({
    launchType,
    confirmOpen,
    fromEmail,
    frozen,
    frozenState,
    onConfirmOpenChange,
    onSubmit,
    projectChipLabel,
    smsPreviewData,
    subject,
  }: {
    readonly launchType: string;
    readonly confirmOpen: boolean;
    readonly fromEmail: string | null;
    readonly frozen: boolean;
    readonly frozenState: string;
    readonly onConfirmOpenChange: (open: boolean) => void;
    readonly onSubmit: () => void;
    readonly projectChipLabel: string;
    readonly smsPreviewData: {
      readonly reachable: number;
      readonly totalSegments: number;
    } | null;
    readonly subject: string;
  }) => (
    <section data-testid="review-step">
      <div>ReviewStep</div>
      <div data-testid="review-launch-type">{launchType}</div>
      <div data-testid="review-from-email">{fromEmail ?? "none"}</div>
      <div data-testid="review-frozen">{String(frozen)}</div>
      <div data-testid="review-state">{frozenState}</div>
      <div data-testid="review-scope">{projectChipLabel}</div>
      <div data-testid="review-subject">{subject}</div>
      <div data-testid="review-confirm-open">{String(confirmOpen)}</div>
      <div data-testid="review-sms-reachable">
        {String(smsPreviewData?.reachable ?? 0)}
      </div>
      <button
        type="button"
        aria-label="review-open-confirm"
        onClick={() => {
          onConfirmOpenChange(true);
        }}
      >
        Open confirm
      </button>
      <button type="button" aria-label="review-submit" onClick={onSubmit}>
        Submit
      </button>
    </section>
  ),
}));

vi.mock("../../app/broadcasts/new/_components/wizard-rail", () => ({
  WizardRail: ({
    currentStep,
    onStepChange,
    statusLabel,
    steps,
  }: {
    readonly currentStep: number;
    readonly onStepChange: (index: number) => void;
    readonly statusLabel: string;
    readonly steps: readonly { readonly id: string; readonly title: string }[];
  }) => (
    <aside data-testid="wizard-rail">
      <div data-testid="current-step">{String(currentStep)}</div>
      <div data-testid="status-label">{statusLabel}</div>
      {steps.map((step, index) => (
        <button
          key={step.id}
          type="button"
          aria-label={`go-step-${String(index)}`}
          onClick={() => {
            onStepChange(index);
          }}
        >
          {step.title}
        </button>
      ))}
    </aside>
  ),
}));

import { NewCampaignWizard } from "../../app/broadcasts/new/_components/new-campaign-wizard";
import type {
  AudienceBuilderBootstrap,
  CampaignWizardDraftData,
  ComposePreviewData,
} from "../../app/broadcasts/_lib/audience-data-source";
import type {
  CampaignKind,
  ExpeditionMemberStatus,
  LaunchType,
} from "@as-comms/contracts";

const workerRequire = createRequire(import.meta.url);
const { JSDOM } = workerRequire("jsdom") as {
  readonly JSDOM: new (
    html?: string,
    options?: {
      readonly pretendToBeVisual?: boolean;
      readonly url?: string;
    },
  ) => {
    readonly window: Window & typeof globalThis;
  };
};

let root: Root | null = null;

function buildBootstrap(
  overrides: Partial<AudienceBuilderBootstrap> = {},
): AudienceBuilderBootstrap {
  return {
    projects: [
      {
        host: {
          id: "host-1",
          name: "Forests Host",
          alias: "forests",
          projectAlias: "Forests",
          aliasHint: "forests@",
          connectedToProjectId: null,
          isSubProject: false,
        },
        connectedSubs: [
          {
            id: "project-1",
            name: "Beech Leaf Disease",
            alias: null,
            projectAlias: "Forests",
            aliasHint: "forests@",
            connectedToProjectId: "host-1",
            isSubProject: true,
          },
        ],
      },
    ],
    expeditions: [],
    senderOptions: [
      {
        projectId: "project-1",
        projectName: "Beech Leaf Disease",
        projectAliasLabel: "Forests",
        email: "forests@example.org",
        connectedToProjectId: "host-1",
        status: "verified",
        senderType: "project",
      },
    ],
    activeSmsSender: {
      id: "sms-sender-1",
      displayName: "Adventure Scientists",
      phoneE164: "+14065550199",
    },
    statuses: ["Waitlist", "Applied"] as readonly ExpeditionMemberStatus[],
    ...overrides,
  };
}

function buildDraft(
  overrides: Partial<CampaignWizardDraftData> = {},
): CampaignWizardDraftData {
  return {
    runId: "run-1",
    launchType: "normal_email",
    kind: "project",
    name: "Spring update",
    fromEmail: "forests@example.org",
    replyToEmail: "forests@example.org",
    subjectTemplate: "Default subject",
    bodyDesignJson: null,
    bodyHtmlTemplate: "<p>Hello {{firstName}}</p>",
    bodyTextTemplate: "Hello {{firstName}}",
    preheader: "Preview line",
    audienceCriteria: {
      projectId: "project-1",
      projectIds: ["project-1"],
      statuses: [],
      contactIds: ["contact-1"],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: 2,
    state: "draft",
    scheduledAt: null,
    updatedAt: "2026-05-21T12:00:00.000Z",
    operatorEmail: "operator@example.org",
    ...overrides,
  };
}

function buildComposePreviewData(
  overrides: Partial<ComposePreviewData> = {},
): ComposePreviewData {
  return {
    audienceSize: 2,
    sampleIndex: 0,
    sampleCount: 1,
    sample: {
      contactId: "contact-1",
      name: "Alice Example",
      initials: "AE",
      email: "alice@example.org",
      project: "Beech Leaf Disease",
      fromEmail: "forests@example.org",
      subject: "Default subject",
      html: "<p>Hello Alice</p>",
      text: "Hello Alice",
    },
    warningCount: 0,
    affectedContacts: [],
    footerAddress: "123 Main St",
    ...overrides,
  };
}

function buildSmsPreviewData() {
  return {
    selected: 12,
    reachable: 9,
    deduplicatedByPhone: 1,
    frozen: 8,
    unreachable: {
      no_consent: 1,
      revoked: 1,
      no_phone: 1,
    },
    totalSegments: 14,
    estCostUsd: 0.1106,
    sampleBody: "Hi Alice Reply STOP to opt out.",
  };
}

interface SaveActionInput {
  readonly audienceCriteria: CampaignWizardDraftData["audienceCriteria"];
  readonly audienceSize: number | null;
  readonly bodyHtmlTemplate: string | null;
  readonly bodyTextTemplate: string | null;
  readonly fromEmail: string | null;
  readonly kind: CampaignKind;
  readonly launchType: LaunchType;
  readonly name: string | null;
  readonly preheader: string | null;
  readonly replyToEmail: string | null;
  readonly runId: string;
  readonly subjectTemplate: string | null;
}

function buildSaveResult(
  input: SaveActionInput,
  overrides: Partial<CampaignWizardDraftData> = {},
) {
  return {
    ok: true as const,
    data: {
      runId: input.runId,
      launchType: input.launchType,
      kind: input.kind,
      name: input.name,
      fromEmail: input.fromEmail,
      replyToEmail: input.replyToEmail,
      subjectTemplate: input.subjectTemplate,
      bodyHtmlTemplate: input.bodyHtmlTemplate,
      bodyTextTemplate: input.bodyTextTemplate,
      preheader: input.preheader,
      audienceCriteria: input.audienceCriteria,
      audienceSize: input.audienceSize,
      state: "draft",
      scheduledAt: null,
      updatedAt: "2026-05-21T12:00:00.000Z",
      operatorEmail: "operator@example.org",
      ...overrides,
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, reject, resolve };
}

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/broadcasts/new",
  });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function renderWizard({
  bootstrap = buildBootstrap(),
  draft = buildDraft(),
}: {
  readonly bootstrap?: AudienceBuilderBootstrap;
  readonly draft?: CampaignWizardDraftData;
} = {}) {
  act(() => {
    root?.render(
      <NewCampaignWizard bootstrap={bootstrap} draft={draft} isAdmin={false} />,
    );
  });
  await flush();
}

function getByTestId(testId: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`,
  );
  if (element === null) {
    throw new Error(`Missing element with test id "${testId}"`);
  }
  return element;
}

function getByLabelText(label: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[aria-label="${label}"]`,
  );
  if (element === null) {
    throw new Error(`Missing element with aria-label "${label}"`);
  }
  return element;
}

async function click(label: string) {
  const element = getByLabelText(label);
  act(() => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
  await flush();
}

async function changeInput(label: string, value: string) {
  const element = getByLabelText(label) as HTMLInputElement;
  act(() => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

async function advanceTimersBy(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

async function goToComposeStep() {
  await click("launch-continue");
  await click("name-continue");
  await click("audience-continue");
}

beforeEach(() => {
  setupDom();

  resolveAudienceCountActionMock.mockResolvedValue({
    ok: true,
    data: { count: 2, hasAppliedFilters: true },
  });
  previewAudienceActionMock.mockResolvedValue({
    ok: true,
    data: [
      {
        contactId: "contact-1",
        name: "Alice Example",
        email: "alice@example.org",
        project: "Beech Leaf Disease",
        projectAlias: "Forests",
        projectAliasHint: "forests@",
      },
    ],
  });
  loadComposePreviewActionMock.mockResolvedValue({
    ok: true,
    data: buildComposePreviewData(),
  });
  loadSelectedAliasSignatureActionMock.mockResolvedValue({
    ok: true,
    data: "Adventure Scientists\n123 Main St",
  });
  loadMemberStatusCountsForProjectsMock.mockResolvedValue({
    ok: true,
    data: { Waitlist: 2 },
  });
  searchProjectVolunteersActionMock.mockResolvedValue({
    ok: true,
    data: [
      {
        contactId: "contact-1",
        name: "Alice Example",
        email: "alice@example.org",
        project: "Beech Leaf Disease",
        projectAlias: "Forests",
        projectAliasHint: "forests@",
      },
    ],
  });
  searchNewsletterSubscribersActionMock.mockResolvedValue({
    ok: true,
    data: [
      {
        subscriberId: "11111111-1111-1111-1111-111111111111",
        email: "alpha@example.org",
        firstName: "Alpha",
      },
    ],
  });
  saveCampaignWizardDraftActionMock.mockImplementation(
    (input: SaveActionInput) => Promise.resolve(buildSaveResult(input)),
  );
  scheduleMock.mockResolvedValue({
    ok: true,
    data: { scheduledAt: "2026-05-22T18:00:00.000Z" },
  });
  sendNowMock.mockResolvedValue({
    ok: true,
    data: { scheduledAt: null },
  });
  sendSmsBroadcastNowMock.mockResolvedValue({
    ok: true,
    data: {
      frozen: 8,
      reachable: 9,
      selected: 12,
      deduplicatedByPhone: 1,
      unreachable: {
        no_consent: 1,
        revoked: 1,
        no_phone: 1,
      },
    },
  });
  testSendMock.mockResolvedValue({
    ok: true,
    data: { recipientEmail: "operator@example.org" },
  });
  sendSmsBroadcastTestMock.mockResolvedValue({
    ok: true,
    data: { segments: 2 },
  });
  previewSmsBroadcastMock.mockResolvedValue({
    ok: true,
    data: buildSmsPreviewData(),
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  vi.useRealTimers();
  vi.clearAllMocks();
  if (typeof document !== "undefined") {
    document.body.innerHTML = "";
  }
});

describe("NewCampaignWizard", () => {
  it("starts on launch type for draft campaigns", async () => {
    await renderWizard({
      draft: buildDraft({ state: "draft" }),
    });

    expect(getByTestId("current-step").textContent).toBe("0");
    expect(getByTestId("launch-step").textContent).toContain("LaunchTypeStep");
  });

  it("starts on review for non-draft campaigns", async () => {
    await renderWizard({
      draft: buildDraft({ state: "scheduled" }),
    });

    expect(getByTestId("current-step").textContent).toBe("5");
    expect(getByTestId("review-step").textContent).toContain("ReviewStep");
  });

  it("keeps frozen campaigns on the current step when the rail is clicked", async () => {
    await renderWizard({
      draft: buildDraft({ state: "scheduled" }),
    });

    await click("go-step-0");

    expect(getByTestId("current-step").textContent).toBe("5");
    expect(getByTestId("review-state").textContent).toBe("scheduled");
  });

  it("autosaves and advances when continuing from launch type", async () => {
    await renderWizard();

    await click("set-launch-html");
    await click("launch-continue");

    expect(saveCampaignWizardDraftActionMock).toHaveBeenCalledTimes(1);
    expect(saveCampaignWizardDraftActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        launchType: "html_email",
      }),
    );
    expect(getByTestId("current-step").textContent).toBe("1");
    expect(getByTestId("name-sender-step").textContent).toContain(
      "NameAndSenderStep",
    );
  });

  it("marks the draft dirty when the subject changes", async () => {
    vi.useFakeTimers();

    await renderWizard();
    await goToComposeStep();
    await advanceTimersBy(2000);

    expect(getByTestId("status-label").textContent).toBe("All changes saved");

    await click("set-subject-updated");

    expect(getByTestId("status-label").textContent).toBe("Unsaved changes");
  });

  it("loads the alias signature and includes preheader in compose preview requests", async () => {
    vi.useFakeTimers();

    await renderWizard({
      draft: buildDraft({
        fromEmail: "forests@adventurescientists.org",
        preheader: "Preview copy",
      }),
    });

    await goToComposeStep();
    await advanceTimersBy(200);

    expect(getByTestId("compose-signature").textContent).toBe(
      "Adventure Scientists\n123 Main St",
    );
    expect(loadSelectedAliasSignatureActionMock).toHaveBeenCalledWith({
      aliasEmail: "forests@adventurescientists.org",
    });
    expect(loadComposePreviewActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        preheader: "Preview copy",
      }),
    );
  });

  it("moves save state through saving, saved, and idle after autosave succeeds", async () => {
    vi.useFakeTimers();
    const deferred = createDeferred<ReturnType<typeof buildSaveResult>>();

    saveCampaignWizardDraftActionMock.mockReturnValueOnce(deferred.promise);

    await renderWizard();

    await click("set-launch-html");
    await click("launch-continue");

    expect(getByTestId("status-label").textContent).toBe("Saving draft…");

    const saveInput = saveCampaignWizardDraftActionMock.mock.calls[0]?.[0] as
      | SaveActionInput
      | undefined;
    if (saveInput === undefined) {
      throw new Error("Expected saveCampaignWizardDraftAction to be called.");
    }

    deferred.resolve(buildSaveResult(saveInput));
    await flush();

    expect(getByTestId("status-label").textContent).toBe("Saved");

    await advanceTimersBy(2000);

    expect(getByTestId("status-label").textContent).toBe("All changes saved");
  });

  it("clears volunteer search state when the launch type changes", async () => {
    vi.useFakeTimers();

    await renderWizard();
    await click("launch-continue");
    await click("name-continue");
    await click("mode-specific");
    await click("search-alice");
    await advanceTimersBy(300);

    expect(searchProjectVolunteersActionMock).toHaveBeenCalled();
    expect(getByTestId("volunteer-rows").textContent).toContain(
      "Alice Example",
    );

    await click("go-step-0");
    await click("set-launch-html");
    await click("launch-continue");
    await click("name-continue");

    expect((getByLabelText("volunteer-search") as HTMLInputElement).value).toBe(
      "",
    );
    expect(getByTestId("volunteer-rows").textContent).toBe("");
  });

  it("auto-populates from and reply-to from the suggested sender email", async () => {
    await renderWizard({
      draft: buildDraft({
        fromEmail: null,
        replyToEmail: null,
      }),
    });

    await click("launch-continue");

    expect(getByTestId("current-from-email").textContent).toBe(
      "forests@example.org",
    );

    await changeInput("campaign-name", "Spring update v2");
    await click("name-continue");

    expect(saveCampaignWizardDraftActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromEmail: "forests@example.org",
        replyToEmail: "forests@example.org",
      }),
    );
  });

  it("treats an org sender as newsletter-kind and gates the audience step to specific plus all-available modes", async () => {
    await renderWizard({
      bootstrap: buildBootstrap({
        senderOptions: [
          {
            projectId: "project-1",
            projectName: "Beech Leaf Disease",
            projectAliasLabel: "Forests",
            email: "forests@example.org",
            connectedToProjectId: "host-1",
            status: "verified",
            senderType: "project",
          },
          {
            projectId: null,
            projectName: "Adventure Scientists",
            projectAliasLabel: "Adventure Scientists",
            email: "info@adventurescientists.org",
            connectedToProjectId: null,
            status: "verified",
            senderType: "org",
          },
        ],
      }),
      draft: buildDraft({
        fromEmail: "forests@example.org",
        replyToEmail: "forests@example.org",
      }),
    });

    await click("launch-continue");
    await click("sender-info@adventurescientists.org");
    await click("name-continue");

    expect(saveCampaignWizardDraftActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromEmail: "info@adventurescientists.org",
        replyToEmail: "info@adventurescientists.org",
        kind: "newsletter",
      }),
    );
    expect(getByTestId("audience-available-modes").textContent).toBe(
      "specific,all_available",
    );
    expect(
      document.querySelector('[aria-label="mode-project-status"]'),
    ).toBeNull();
  });

  it("searches newsletter subscribers for org senders and persists newsletterSubscriberIds", async () => {
    vi.useFakeTimers();

    await renderWizard({
      bootstrap: buildBootstrap({
        senderOptions: [
          {
            projectId: null,
            projectName: "Adventure Scientists",
            projectAliasLabel: "Adventure Scientists",
            email: "info@adventurescientists.org",
            connectedToProjectId: null,
            status: "verified",
            senderType: "org",
          },
        ],
      }),
      draft: buildDraft({
        kind: "newsletter",
        fromEmail: "info@adventurescientists.org",
        replyToEmail: "info@adventurescientists.org",
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
      }),
    });

    await click("launch-continue");
    await click("name-continue");
    await click("mode-specific");
    await click("search-alice");
    await advanceTimersBy(300);

    expect(searchNewsletterSubscribersActionMock).toHaveBeenCalledWith({
      query: "alice",
    });
    expect(getByTestId("volunteer-rows").textContent).toContain("Alpha");

    await click("toggle-row-11111111-1111-1111-1111-111111111111");
    await click("audience-continue");

    const savedInput = saveCampaignWizardDraftActionMock.mock.calls.at(
      -1,
    )?.[0] as SaveActionInput | undefined;
    expect(savedInput).toMatchObject({
      kind: "newsletter",
      audienceCriteria: {
        initialFilter: "specific",
        newsletterSubscriberIds: ["11111111-1111-1111-1111-111111111111"],
      },
    });
  });

  it("calls sendSmsBroadcastTest with the entered E.164 number for SMS launches", async () => {
    vi.useFakeTimers();

    await renderWizard({
      draft: buildDraft({
        launchType: "sms",
        kind: "project",
        fromEmail: null,
        replyToEmail: null,
        subjectTemplate: null,
        bodyHtmlTemplate: null,
        bodyTextTemplate: "Hello {{firstName}}",
        preheader: null,
      }),
    });

    await click("set-launch-sms");
    await goToComposeStep();
    await click("compose-continue");
    await advanceTimersBy(200);
    await click("set-preview-test-recipient");
    await click("preview-send-test");

    expect(sendSmsBroadcastTestMock).toHaveBeenCalledWith({
      runId: "run-1",
      toPhoneE164: "+14065550123",
    });
    expect(testSendMock).not.toHaveBeenCalled();
  });

  it("calls sendSmsBroadcastNow on SMS review submit without hitting email send actions", async () => {
    vi.useFakeTimers();

    await renderWizard({
      draft: buildDraft({
        launchType: "sms",
        kind: "project",
        fromEmail: null,
        replyToEmail: null,
        subjectTemplate: null,
        bodyHtmlTemplate: null,
        bodyTextTemplate: "Hello {{firstName}}",
        preheader: null,
      }),
    });

    await click("set-launch-sms");
    await goToComposeStep();
    await click("compose-continue");
    await advanceTimersBy(200);
    await click("preview-continue");
    await click("review-submit");

    expect(sendSmsBroadcastNowMock).toHaveBeenCalledWith({ runId: "run-1" });
    expect(sendNowMock).not.toHaveBeenCalled();
    expect(scheduleMock).not.toHaveBeenCalled();
  });
});
