import { createRequire } from "node:module";

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  ArrowLeft: () => null,
  ArrowRight: () => null,
  Check: () => null,
  CheckCircle2: () => null,
  Eye: () => null,
  Filter: () => null,
  LoaderCircle: () => null,
  Lock: () => null,
  Search: () => null,
  Sparkles: () => null,
  User: () => null,
  Users: () => null,
  X: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { readonly children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

import { AudienceBuilderStep } from "../../app/broadcasts/new/_components/audience-builder-step";
import type {
  AudienceBuilderBootstrap,
  CampaignWizardDraftData,
} from "../../app/broadcasts/_lib/audience-data-source";

const workerRequire = createRequire(import.meta.url);
const { JSDOM } = workerRequire("jsdom") as {
  readonly JSDOM: new (
    html?: string,
    options?: {
      readonly url?: string;
      readonly pretendToBeVisual?: boolean;
    },
  ) => {
    readonly window: Window & typeof globalThis;
  };
};

let root: Root | null = null;

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/broadcasts/new",
    pretendToBeVisual: true,
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
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.Event = dom.window.Event;
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

async function settleAsyncWork() {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  if (typeof document !== "undefined") {
    document.body.innerHTML = "";
  }
  root = null;
  vi.resetModules();
  vi.clearAllMocks();
});

const baseProps: React.ComponentProps<typeof AudienceBuilderStep> = {
  availableModes: ["project_status", "specific"],
  hasPickedMode: false,
  selectedSenderType: "project",
  criteria: {
    projectId: null,
    projectIds: [],
    statuses: [],
    contactIds: [],
    expeditionIds: [],
    lastActivityWindow: "all_time",
    hasReplied: "either",
    hasClicked: "either",
  },
  countState: {
    count: 0,
    hasAppliedFilters: false,
  },
  previewRows: [],
  countLoading: false,
  previewLoading: false,
  previewErrorMessage: null,
  volunteerSearchQuery: "",
  volunteerSearchRows: [],
  volunteerSearchLoading: false,
  volunteerSearchErrorMessage: null,
  projectOptions: [],
  statusOptions: ["Waitlist"],
  statusCounts: {},
  statusCountsLoading: false,
  statusCountsErrorMessage: null,
  onInitialFilterChange: () => undefined,
  onProjectChange: () => undefined,
  onToggleAllStatuses: () => undefined,
  onStatusToggle: () => undefined,
  onVolunteerSearchQueryChange: () => undefined,
  onVolunteerToggle: () => undefined,
  onBack: () => undefined,
  onContinue: () => undefined,
};

describe("AudienceBuilderStep initial filter gate", () => {
  it("renders the pre-choice mode chooser without the downstream panels", () => {
    const markup = renderToStaticMarkup(<AudienceBuilderStep {...baseProps} />);

    expect(markup).toContain("Project / status");
    expect(markup).toContain("Individual volunteers");
    expect(markup).not.toContain("Audience filters");
    expect(markup).not.toContain("Find volunteers");
    expect(markup).not.toContain("Audience preview");
  });

  it("renders the org-sender specific-individuals surface when only that mode is allowed", () => {
    const markup = renderToStaticMarkup(
      <AudienceBuilderStep
        {...baseProps}
        hasPickedMode={true}
        availableModes={["specific"]}
        selectedSenderType="org"
        criteria={{
          ...baseProps.criteria,
          initialFilter: "specific",
        }}
      />,
    );

    expect(markup).toContain("Individual volunteers");
    expect(markup).toContain("Find newsletter subscribers");
    expect(markup).toContain(
      "Type at least 2 characters to search newsletter subscribers.",
    );
    expect(markup).not.toContain("Project / status");
    expect(markup).not.toContain("All approved contacts");
  });

  it("renders the newsletter all-available surface without project filters", () => {
    const markup = renderToStaticMarkup(
      <AudienceBuilderStep
        {...baseProps}
        hasPickedMode={true}
        availableModes={["specific", "all_available"]}
        criteria={{
          ...baseProps.criteria,
          initialFilter: "all_available",
        }}
        countState={{
          count: 12,
          hasAppliedFilters: true,
        }}
      />,
    );

    expect(markup).toContain("All newsletter subscribers");
    expect(markup).toContain(
      "This broadcast goes to every subscribed newsletter recipient, minus suppressions.",
    );
    expect(markup).not.toContain("Audience filters");
    expect(markup).not.toContain("Find volunteers");
  });

  it("renders only the project and status surface in project mode", () => {
    const markup = renderToStaticMarkup(
      <AudienceBuilderStep
        {...baseProps}
        hasPickedMode={true}
        projectOptions={[
          {
            id: "project-1",
            name: "Restoring Butternut Forest Health",
            alias: null,
            projectAlias: "Beech & Butternut",
            aliasHint: "forests@",
            connectedToProjectId: "host-project",
            isSubProject: true,
          },
          {
            id: "project-2",
            name: "Saving American Beech",
            alias: null,
            projectAlias: "Beech & Butternut",
            aliasHint: "forests@",
            connectedToProjectId: "host-project",
            isSubProject: true,
          },
        ]}
        criteria={{
          ...baseProps.criteria,
          projectId: "project-1",
          projectIds: ["project-1", "project-2"],
          statuses: ["Waitlist"],
          initialFilter: "project_status",
        }}
        countState={{
          count: 42,
          hasAppliedFilters: true,
        }}
        statusCounts={{
          Waitlist: 42,
        }}
      />,
    );

    expect(markup).toContain("Audience filters");
    expect(markup).toContain("Inherited from forests@");
    expect(markup).toContain("Member status");
    expect(markup).toContain("Waitlist");
    expect(markup).not.toContain("TOP-FUNNEL");
    expect(markup).not.toContain("Search by name or email");
    expect(markup).not.toContain("Find volunteers");
  });

  it("renders only the volunteer search surface in individual mode", () => {
    const markup = renderToStaticMarkup(
      <AudienceBuilderStep
        {...baseProps}
        hasPickedMode={true}
        criteria={{
          ...baseProps.criteria,
          projectId: "project-1",
          projectIds: ["project-1", "project-2"],
          contactIds: [],
          initialFilter: "specific",
        }}
      />,
    );

    expect(markup).toContain("Find volunteers");
    expect(markup).toContain("Search by name or email");
    expect(markup).not.toContain("Audience filters");
    expect(markup).not.toContain("Member status");
    expect(markup).not.toContain("Toggle expedition-member status");
  });

  it("renders human project aliases for volunteer search results and preview rows", () => {
    const longProjectName =
      "Passive Acoustic Monitoring of Pacific Northwest Forests";
    const markup = renderToStaticMarkup(
      <AudienceBuilderStep
        {...baseProps}
        hasPickedMode={true}
        criteria={{
          ...baseProps.criteria,
          projectId: "project-1",
          projectIds: ["project-1"],
          contactIds: ["contact-1"],
          initialFilter: "specific",
        }}
        volunteerSearchQuery="nic"
        volunteerSearchRows={[
          {
            contactId: "contact-1",
            name: "Nicole Moss",
            email: "nic@example.org",
            project: longProjectName,
            projectAlias: "PNW Biodiversity",
            projectAliasHint: "pnwbio@",
          },
        ]}
        previewRows={[
          {
            contactId: "contact-1",
            name: "Nicole Moss",
            email: "nic@example.org",
            project: longProjectName,
            projectAlias: "PNW Biodiversity",
            projectAliasHint: "pnwbio@",
          },
        ]}
      />,
    );

    expect(markup).toContain("PNW Biodiversity");
    expect(markup).not.toContain("pnwbio@");
    expect(markup).not.toContain(longProjectName);
  });

  it("disables continue when the live audience is zero", () => {
    const invalidMarkup = renderToStaticMarkup(
      <AudienceBuilderStep {...baseProps} />,
    );
    const validMarkup = renderToStaticMarkup(
      <AudienceBuilderStep
        {...baseProps}
        hasPickedMode={true}
        criteria={{
          ...baseProps.criteria,
          projectId: "project-1",
          projectIds: ["project-1"],
          statuses: ["Waitlist"],
          initialFilter: "project_status",
        }}
        countState={{
          count: 12,
          hasAppliedFilters: true,
        }}
      />,
    );

    expect(invalidMarkup).toMatch(
      /<button[^>]*aria-disabled="true"[^>]*>Continue<\/button>/,
    );
    expect(validMarkup).not.toMatch(
      /<button[^>]*aria-disabled="true"[^>]*>Continue<\/button>/,
    );
  });

  it("collapses into the segmented control after the operator picks a mode", () => {
    setupDom();

    function Harness() {
      const [criteria, setCriteria] = React.useState(baseProps.criteria);
      const [hasPickedMode, setHasPickedMode] = React.useState(false);

      return (
        <AudienceBuilderStep
          {...baseProps}
          hasPickedMode={hasPickedMode}
          criteria={criteria}
          onInitialFilterChange={(value) => {
            setHasPickedMode(true);
            setCriteria((current) => ({
              ...current,
              initialFilter: value,
            }));
          }}
        />
      );
    }

    act(() => {
      root?.render(<Harness />);
    });

    expect(document.body.textContent).toContain("Project / status");
    expect(document.body.textContent).not.toContain("Audience filters");
    expect(document.body.textContent).not.toContain("Find volunteers");

    const projectStatusButton = Array.from(
      document.querySelectorAll("button"),
    ).find((button) => button.textContent.includes("Project / status"));
    if (!(projectStatusButton instanceof HTMLButtonElement)) {
      throw new Error("Project / status chooser button not found");
    }

    act(() => {
      projectStatusButton.click();
    });

    const tablist = document.querySelector(
      '[role="tablist"][aria-label="Audience mode"]',
    );
    if (!(tablist instanceof HTMLElement)) {
      throw new Error("Audience mode segmented control not found");
    }

    expect(tablist.className).toContain("rounded-md");
    expect(document.body.textContent).toContain("Audience filters");
    expect(document.body.textContent).not.toContain("Find volunteers");
  });

  it("does not retrigger the member-status-counts fetch when only statuses change", async () => {
    setupDom();

    const loadMemberStatusCountsForProjects = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { Waitlist: 5 },
      }),
    );
    const resolveAudienceCountAction = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { count: 5, hasAppliedFilters: true },
      }),
    );
    const previewAudienceAction = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: [],
      }),
    );
    const searchProjectVolunteersAction = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: [],
      }),
    );
    const loadComposePreviewAction = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          audienceSize: 0,
          sampleIndex: 0,
          sampleCount: 0,
          sample: null,
          warningCount: 0,
          affectedContacts: [],
          footerAddress: null,
        },
      }),
    );
    const saveCampaignWizardDraftAction = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          runId: "run-1",
          launchType: "normal_email",
          kind: "project",
          name: null,
          fromEmail: "forests@adventurescientists.org",
          replyToEmail: "forests@adventurescientists.org",
          subjectTemplate: null,
          bodyHtmlTemplate: null,
          bodyTextTemplate: null,
          preheader: null,
          audienceCriteria: {
            projectId: null,
            projectIds: [],
            statuses: [],
            contactIds: [],
            expeditionIds: [],
            lastActivityWindow: "all_time",
            hasReplied: "either",
            hasClicked: "either",
          },
          audienceSize: null,
          state: "draft",
          scheduledAt: null,
          updatedAt: "2026-05-20T12:00:00.000Z",
          operatorEmail: "operator@example.com",
        },
      }),
    );

    vi.doMock("../../app/broadcasts/_lib/audience-data-source", () => ({
      loadMemberStatusCountsForProjects,
      loadComposePreviewAction,
      loadSelectedAliasSignatureAction: vi.fn(() =>
        Promise.resolve({ ok: true as const, data: "" }),
      ),
      previewAudienceAction,
      resolveAudienceCountAction,
      saveCampaignWizardDraftAction,
      searchProjectVolunteersAction,
    }));
    vi.doMock("../../app/broadcasts/actions", () => ({
      schedule: vi.fn(),
      sendNow: vi.fn(),
      testSend: vi.fn(),
    }));
    vi.doMock("../../app/broadcasts/new/_components/launch-type-step", () => ({
      LaunchTypeStep: ({ onContinue }: { readonly onContinue: () => void }) => (
        <button onClick={onContinue}>Launch continue</button>
      ),
    }));
    vi.doMock(
      "../../app/broadcasts/new/_components/name-and-sender-step",
      () => ({
        NameAndSenderStep: ({
          onContinue,
        }: {
          readonly onContinue: () => void;
        }) => <button onClick={onContinue}>Sender continue</button>,
      }),
    );
    vi.doMock(
      "../../app/broadcasts/new/_components/audience-builder-step",
      () => ({
        AudienceBuilderStep: ({
          onStatusToggle,
        }: {
          readonly onStatusToggle: (status: string) => void;
        }) => (
          <button
            onClick={() => {
              onStatusToggle("Waitlist");
            }}
          >
            Toggle Waitlist
          </button>
        ),
      }),
    );
    vi.doMock("../../app/broadcasts/new/_components/compose-step", () => ({
      ComposeStep: () => <div>Compose</div>,
    }));
    vi.doMock("../../app/broadcasts/new/_components/preview-step", () => ({
      PreviewStep: () => <div>Preview</div>,
    }));
    vi.doMock("../../app/broadcasts/new/_components/review-step", () => ({
      ReviewStep: () => <div>Review</div>,
    }));
    vi.doMock("../../app/broadcasts/new/_components/wizard-rail", () => ({
      WizardRail: () => null,
    }));

    const { NewCampaignWizard } =
      await import("../../app/broadcasts/new/_components/new-campaign-wizard");

    const bootstrap: AudienceBuilderBootstrap = {
      projects: [
        {
          host: {
            id: "host-project",
            name: "Saving American Beech",
            alias: null,
            projectAlias: "Beech & Butternut",
            aliasHint: "forests@",
            connectedToProjectId: null,
            isSubProject: false,
          },
          connectedSubs: [
            {
              id: "sub-project",
              name: "Restoring Butternut Forest Health",
              alias: null,
              projectAlias: "Beech & Butternut",
              aliasHint: "forests@",
              connectedToProjectId: "host-project",
              isSubProject: true,
            },
          ],
        },
      ],
      expeditions: [],
      statuses: ["Waitlist", "Denied"],
      senderOptions: [
        {
          projectId: "host-project",
          projectName: "Saving American Beech",
          projectAliasLabel: "forests@",
          email: "forests@adventurescientists.org",
          connectedToProjectId: null,
          status: "verified",
          senderType: "project",
        },
      ],
      activeSmsSender: {
        id: "sms-sender-1",
        displayName: "Adventure Scientists",
        phoneE164: "+14065550199",
      },
    };
    const draft: CampaignWizardDraftData = {
      runId: "run-1",
      launchType: "normal_email",
      kind: "project",
      name: null,
      fromEmail: "forests@adventurescientists.org",
      replyToEmail: "forests@adventurescientists.org",
      subjectTemplate: null,
      bodyDesignJson: null,
      bodyHtmlTemplate: null,
      bodyTextTemplate: null,
      preheader: null,
      audienceCriteria: {
        projectId: "host-project",
        projectIds: ["host-project", "sub-project"],
        statuses: [],
        contactIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time",
        hasReplied: "either",
        hasClicked: "either",
      },
      audienceSize: null,
      state: "draft",
      scheduledAt: null,
      updatedAt: "2026-05-20T12:00:00.000Z",
      operatorEmail: "operator@example.com",
    };

    act(() => {
      root?.render(
        <NewCampaignWizard
          bootstrap={bootstrap}
          draft={draft}
          isAdmin={true}
        />,
      );
    });
    await settleAsyncWork();

    const launchContinueButton = Array.from(
      document.querySelectorAll("button"),
    ).find((button) => button.textContent === "Launch continue");
    if (!(launchContinueButton instanceof HTMLButtonElement)) {
      throw new Error("Launch continue button not found");
    }

    act(() => {
      launchContinueButton.click();
    });
    await settleAsyncWork();

    const senderContinueButton = Array.from(
      document.querySelectorAll("button"),
    ).find((button) => button.textContent === "Sender continue");
    if (!(senderContinueButton instanceof HTMLButtonElement)) {
      throw new Error("Sender continue button not found");
    }

    act(() => {
      senderContinueButton.click();
    });
    await settleAsyncWork();
    await settleAsyncWork();
    await settleAsyncWork();

    expect(loadMemberStatusCountsForProjects).toHaveBeenCalledTimes(1);
    const initialAudienceCountCalls =
      resolveAudienceCountAction.mock.calls.length;

    const toggleWaitlistButton = Array.from(
      document.querySelectorAll("button"),
    ).find((button) => button.textContent === "Toggle Waitlist");
    if (!(toggleWaitlistButton instanceof HTMLButtonElement)) {
      throw new Error("Toggle Waitlist button not found");
    }

    act(() => {
      toggleWaitlistButton.click();
    });
    await settleAsyncWork();

    act(() => {
      toggleWaitlistButton.click();
    });
    await settleAsyncWork();

    expect(loadMemberStatusCountsForProjects).toHaveBeenCalledTimes(1);
    expect(resolveAudienceCountAction.mock.calls.length).toBeGreaterThan(
      initialAudienceCountCalls,
    );
  });

  it("shows a default zero audience and skips the count action until a status is selected", async () => {
    setupDom();

    const loadMemberStatusCountsForProjects = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { Waitlist: 5 },
      }),
    );
    const resolveAudienceCountAction = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { count: 5, hasAppliedFilters: true },
      }),
    );
    const previewAudienceAction = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: [],
      }),
    );
    const searchProjectVolunteersAction = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: [],
      }),
    );
    const loadComposePreviewAction = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          audienceSize: 0,
          sampleIndex: 0,
          sampleCount: 0,
          sample: null,
          warningCount: 0,
          affectedContacts: [],
          footerAddress: null,
        },
      }),
    );
    const saveCampaignWizardDraftAction = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          runId: "run-1",
          launchType: "normal_email",
          kind: "project",
          name: null,
          fromEmail: "pnwbio@adventurescientists.org",
          replyToEmail: "pnwbio@adventurescientists.org",
          subjectTemplate: null,
          bodyHtmlTemplate: null,
          bodyTextTemplate: null,
          preheader: null,
          audienceCriteria: {
            projectId: null,
            projectIds: [],
            statuses: [],
            contactIds: [],
            expeditionIds: [],
            lastActivityWindow: "all_time",
            hasReplied: "either",
            hasClicked: "either",
          },
          audienceSize: null,
          state: "draft",
          scheduledAt: null,
          updatedAt: "2026-05-20T12:00:00.000Z",
          operatorEmail: "operator@example.com",
        },
      }),
    );

    vi.doMock("../../app/broadcasts/_lib/audience-data-source", () => ({
      loadMemberStatusCountsForProjects,
      loadComposePreviewAction,
      loadSelectedAliasSignatureAction: vi.fn(() =>
        Promise.resolve({ ok: true as const, data: "" }),
      ),
      previewAudienceAction,
      resolveAudienceCountAction,
      saveCampaignWizardDraftAction,
      searchProjectVolunteersAction,
    }));
    vi.doMock("../../app/broadcasts/actions", () => ({
      schedule: vi.fn(),
      sendNow: vi.fn(),
      testSend: vi.fn(),
    }));
    vi.doMock("../../app/broadcasts/new/_components/launch-type-step", () => ({
      LaunchTypeStep: ({ onContinue }: { readonly onContinue: () => void }) => (
        <button onClick={onContinue}>Launch continue</button>
      ),
    }));
    vi.doMock(
      "../../app/broadcasts/new/_components/name-and-sender-step",
      () => ({
        NameAndSenderStep: ({
          onContinue,
        }: {
          readonly onContinue: () => void;
        }) => <button onClick={onContinue}>Sender continue</button>,
      }),
    );
    vi.doMock("../../app/broadcasts/new/_components/compose-step", () => ({
      ComposeStep: () => <div>Compose</div>,
    }));
    vi.doMock("../../app/broadcasts/new/_components/preview-step", () => ({
      PreviewStep: () => <div>Preview</div>,
    }));
    vi.doMock("../../app/broadcasts/new/_components/review-step", () => ({
      ReviewStep: () => <div>Review</div>,
    }));
    vi.doMock("../../app/broadcasts/new/_components/wizard-rail", () => ({
      WizardRail: () => null,
    }));
    vi.doUnmock("../../app/broadcasts/new/_components/audience-builder-step");

    const { NewCampaignWizard } =
      await import("../../app/broadcasts/new/_components/new-campaign-wizard");

    const bootstrap: AudienceBuilderBootstrap = {
      projects: [
        {
          host: {
            id: "project-1",
            name: "Pacific Northwest Bio",
            alias: null,
            projectAlias: "PNW Biodiversity",
            aliasHint: "pnwbio@",
            connectedToProjectId: null,
            isSubProject: false,
          },
          connectedSubs: [],
        },
      ],
      expeditions: [],
      statuses: ["Waitlist"],
      senderOptions: [
        {
          projectId: "project-1",
          projectName: "Pacific Northwest Bio",
          projectAliasLabel: "pnwbio@",
          email: "pnwbio@adventurescientists.org",
          connectedToProjectId: null,
          status: "verified",
          senderType: "project",
        },
      ],
      activeSmsSender: {
        id: "sms-sender-1",
        displayName: "Adventure Scientists",
        phoneE164: "+14065550199",
      },
    };
    const draft: CampaignWizardDraftData = {
      runId: "run-1",
      launchType: "normal_email",
      kind: "project",
      name: null,
      fromEmail: "pnwbio@adventurescientists.org",
      replyToEmail: "pnwbio@adventurescientists.org",
      subjectTemplate: null,
      bodyDesignJson: null,
      bodyHtmlTemplate: null,
      bodyTextTemplate: null,
      preheader: null,
      audienceCriteria: {
        projectId: "project-1",
        projectIds: ["project-1"],
        statuses: [],
        contactIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time",
        hasReplied: "either",
        hasClicked: "either",
      },
      audienceSize: null,
      state: "draft",
      scheduledAt: null,
      updatedAt: "2026-05-20T12:00:00.000Z",
      operatorEmail: "operator@example.com",
    };

    act(() => {
      root?.render(
        <NewCampaignWizard
          bootstrap={bootstrap}
          draft={draft}
          isAdmin={true}
        />,
      );
    });
    await settleAsyncWork();

    const launchContinueButton = Array.from(
      document.querySelectorAll("button"),
    ).find((button) => button.textContent === "Launch continue");
    if (!(launchContinueButton instanceof HTMLButtonElement)) {
      throw new Error("Launch continue button not found");
    }

    act(() => {
      launchContinueButton.click();
    });
    await settleAsyncWork();

    const senderContinueButton = Array.from(
      document.querySelectorAll("button"),
    ).find((button) => button.textContent === "Sender continue");
    if (!(senderContinueButton instanceof HTMLButtonElement)) {
      throw new Error("Sender continue button not found");
    }

    act(() => {
      senderContinueButton.click();
    });
    await settleAsyncWork();
    await settleAsyncWork();
    await settleAsyncWork();

    expect(resolveAudienceCountAction).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "No recipients match the current filters.",
    );

    const continueButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Continue",
    );
    if (!(continueButton instanceof HTMLButtonElement)) {
      throw new Error("Continue button not found");
    }

    expect(continueButton.disabled).toBe(true);
    expect(continueButton.getAttribute("aria-disabled")).toBe("true");
    expect(document.body.textContent).toContain("0");
  });

  it("renders both forests host and connected sub-projects as toggleable project rows", async () => {
    setupDom();

    const loadMemberStatusCountsForProjects = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { Waitlist: 8 },
      }),
    );
    const resolveAudienceCountAction = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { count: 8, hasAppliedFilters: true },
      }),
    );
    const previewAudienceAction = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: [],
      }),
    );
    const searchProjectVolunteersAction = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: [],
      }),
    );
    const loadComposePreviewAction = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          audienceSize: 0,
          sampleIndex: 0,
          sampleCount: 0,
          sample: null,
          warningCount: 0,
          affectedContacts: [],
          footerAddress: null,
        },
      }),
    );
    const saveCampaignWizardDraftAction = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          runId: "run-1",
          launchType: "normal_email",
          kind: "project",
          name: null,
          fromEmail: "forests@adventurescientists.org",
          replyToEmail: "forests@adventurescientists.org",
          subjectTemplate: null,
          bodyHtmlTemplate: null,
          bodyTextTemplate: null,
          preheader: null,
          audienceCriteria: {
            projectId: null,
            projectIds: [],
            statuses: [],
            contactIds: [],
            expeditionIds: [],
            lastActivityWindow: "all_time",
            hasReplied: "either",
            hasClicked: "either",
          },
          audienceSize: null,
          state: "draft",
          scheduledAt: null,
          updatedAt: "2026-05-20T12:00:00.000Z",
          operatorEmail: "operator@example.com",
        },
      }),
    );

    vi.doMock("../../app/broadcasts/_lib/audience-data-source", () => ({
      loadMemberStatusCountsForProjects,
      loadComposePreviewAction,
      loadSelectedAliasSignatureAction: vi.fn(() =>
        Promise.resolve({ ok: true as const, data: "" }),
      ),
      previewAudienceAction,
      resolveAudienceCountAction,
      saveCampaignWizardDraftAction,
      searchProjectVolunteersAction,
    }));
    vi.doMock("../../app/broadcasts/actions", () => ({
      schedule: vi.fn(),
      sendNow: vi.fn(),
      testSend: vi.fn(),
    }));
    vi.doMock("../../app/broadcasts/new/_components/launch-type-step", () => ({
      LaunchTypeStep: ({ onContinue }: { readonly onContinue: () => void }) => (
        <button onClick={onContinue}>Launch continue</button>
      ),
    }));
    vi.doMock(
      "../../app/broadcasts/new/_components/name-and-sender-step",
      () => ({
        NameAndSenderStep: ({
          onContinue,
        }: {
          readonly onContinue: () => void;
        }) => <button onClick={onContinue}>Sender continue</button>,
      }),
    );
    vi.doMock("../../app/broadcasts/new/_components/compose-step", () => ({
      ComposeStep: () => <div>Compose</div>,
    }));
    vi.doMock("../../app/broadcasts/new/_components/preview-step", () => ({
      PreviewStep: () => <div>Preview</div>,
    }));
    vi.doMock("../../app/broadcasts/new/_components/review-step", () => ({
      ReviewStep: () => <div>Review</div>,
    }));
    vi.doMock("../../app/broadcasts/new/_components/wizard-rail", () => ({
      WizardRail: () => null,
    }));

    const { NewCampaignWizard } =
      await import("../../app/broadcasts/new/_components/new-campaign-wizard");

    const bootstrap: AudienceBuilderBootstrap = {
      projects: [
        {
          host: {
            id: "project-butternut",
            name: "Restoring Butternut Forest Health",
            alias: null,
            projectAlias: "Beech & Butternut",
            aliasHint: "forests@",
            connectedToProjectId: null,
            isSubProject: false,
          },
          connectedSubs: [
            {
              id: "project-beech",
              name: "Saving American Beech",
              alias: null,
              projectAlias: "Beech & Butternut",
              aliasHint: "forests@",
              connectedToProjectId: "project-butternut",
              isSubProject: true,
            },
          ],
        },
      ],
      expeditions: [],
      statuses: ["Waitlist"],
      senderOptions: [
        {
          projectId: "project-butternut",
          projectName: "Restoring Butternut Forest Health",
          projectAliasLabel: "forests@",
          email: "forests@adventurescientists.org",
          connectedToProjectId: null,
          status: "verified",
          senderType: "project",
        },
      ],
      activeSmsSender: {
        id: "sms-sender-1",
        displayName: "Adventure Scientists",
        phoneE164: "+14065550199",
      },
    };
    const draft: CampaignWizardDraftData = {
      runId: "run-1",
      launchType: "normal_email",
      kind: "project",
      name: null,
      fromEmail: "forests@adventurescientists.org",
      replyToEmail: "forests@adventurescientists.org",
      subjectTemplate: null,
      bodyDesignJson: null,
      bodyHtmlTemplate: null,
      bodyTextTemplate: null,
      preheader: null,
      audienceCriteria: {
        projectId: "project-butternut",
        projectIds: ["project-butternut", "project-beech"],
        statuses: [],
        contactIds: [],
        expeditionIds: [],
        lastActivityWindow: "all_time",
        hasReplied: "either",
        hasClicked: "either",
      },
      audienceSize: null,
      state: "draft",
      scheduledAt: null,
      updatedAt: "2026-05-20T12:00:00.000Z",
      operatorEmail: "operator@example.com",
    };

    act(() => {
      root?.render(
        <NewCampaignWizard
          bootstrap={bootstrap}
          draft={draft}
          isAdmin={true}
        />,
      );
    });
    await settleAsyncWork();

    const launchContinueButton = Array.from(
      document.querySelectorAll("button"),
    ).find((button) => button.textContent === "Launch continue");
    if (!(launchContinueButton instanceof HTMLButtonElement)) {
      throw new Error("Launch continue button not found");
    }

    act(() => {
      launchContinueButton.click();
    });
    await settleAsyncWork();

    const senderContinueButton = Array.from(
      document.querySelectorAll("button"),
    ).find((button) => button.textContent === "Sender continue");
    if (!(senderContinueButton instanceof HTMLButtonElement)) {
      throw new Error("Sender continue button not found");
    }

    act(() => {
      senderContinueButton.click();
    });
    await settleAsyncWork();
    await settleAsyncWork();
    await settleAsyncWork();

    const projectButtons = Array.from(
      document.querySelectorAll("button"),
    ).filter((button) =>
      button.getAttribute("aria-label")?.startsWith("Choose project "),
    );

    expect(projectButtons).toHaveLength(2);
    expect(
      document.querySelector(
        '[aria-label="Project Restoring Butternut Forest Health is locked to this sender alias"]',
      ),
    ).toBeNull();
    expect(
      document.querySelector(
        '[aria-label="Project Saving American Beech is locked to this sender alias"]',
      ),
    ).toBeNull();
  });
});
