import { createRequire } from "node:module";

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  Link2: () => null,
  Link2Off: () => null,
}));

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

import { StepConnectedProjects } from "../../app/settings/_components/activation-wizard/step-connected-projects";
import { ACTIVATION_WIZARD_STEPS } from "../../app/settings/_components/activation-wizard/shared";
import {
  activationWizardReducer,
  createInitialState,
} from "../../app/settings/_components/activation-wizard/state";
import type { ProjectRowViewModel } from "../../src/server/settings/selectors";

let dom: InstanceType<typeof JSDOM> | null = null;
let root: Root | null = null;

function setupDom() {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/settings",
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
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.Event = dom.window.Event;
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

function makeCandidate(input: {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectAlias?: string | null;
  readonly aiKnowledgeUrl?: string | null;
  readonly memberCount?: number;
}): ProjectRowViewModel {
  return {
    projectId: input.projectId,
    projectName: input.projectName,
    suggestedAlias: input.projectName,
    projectAlias: input.projectAlias ?? null,
    postmarkSenderStatus: "unverified",
    connectedToProjectId: null,
    isActive: false,
    primaryEmail: null,
    emailAliases: [],
    additionalEmailCount: 0,
    aiKnowledgeUrl: input.aiKnowledgeUrl ?? null,
    aiKnowledgeSyncedAt: null,
    hasCachedAiKnowledge: false,
    memberCount: input.memberCount ?? 0,
    activationRequirementsMet: false,
  };
}

beforeEach(() => {
  setupDom();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  document.body.innerHTML = "";
  root = null;
  dom = null;
});

describe("Connected projects wizard step — registration", () => {
  it("registers the automated-email step after signature and before the remaining setup", () => {
    // Step list order is part of the wizard's UX contract: signature ->
    // automated emails -> knowledge -> connected projects -> review.
    const titles = ACTIVATION_WIZARD_STEPS.map((step) => step.title);
    const signatureIndex = titles.indexOf("Email signature");
    const automatedEmailsIndex = titles.indexOf("Automated emails");
    const knowledgeIndex = titles.indexOf("AI knowledge");
    const connectedIndex = titles.indexOf("Connected projects");
    const reviewIndex = titles.indexOf("Review & activate");
    expect(automatedEmailsIndex).toBe(signatureIndex + 1);
    expect(knowledgeIndex).toBeGreaterThanOrEqual(0);
    expect(knowledgeIndex).toBe(automatedEmailsIndex + 1);
    expect(connectedIndex).toBe(knowledgeIndex + 1);
    expect(reviewIndex).toBe(connectedIndex + 1);
  });
});

describe("StepConnectedProjects", () => {
  function renderStep(input: {
    readonly candidates: readonly ProjectRowViewModel[];
    readonly selectedProjectIds?: readonly string[];
    readonly onToggle?: (projectId: string) => void;
  }) {
    if (!root) throw new Error("root not initialized");
    const activeRoot = root;

    act(() => {
      activeRoot.render(
        <StepConnectedProjects
          candidates={input.candidates}
          selectedProjectIds={input.selectedProjectIds ?? []}
          onToggle={input.onToggle ?? (() => undefined)}
        />,
      );
    });
  }

  it("renders one row per candidate with the name", () => {
    renderStep({
      candidates: [
        makeCandidate({ projectId: "p:beech", projectName: "Beech" }),
        makeCandidate({ projectId: "p:butternut", projectName: "Butternut" }),
      ],
    });

    expect(document.body.textContent).toContain("Beech");
    expect(document.body.textContent).toContain("Butternut");
    expect(document.querySelectorAll("input[type=checkbox]")).toHaveLength(2);
  });

  it("renders an empty state when there are no candidates", () => {
    renderStep({ candidates: [] });

    expect(document.body.textContent).toContain(
      "No inactive projects to connect.",
    );
    expect(document.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
  });

  it("calls onToggle with the project id when a checkbox is clicked", () => {
    const onToggle = vi.fn();
    renderStep({
      candidates: [
        makeCandidate({ projectId: "p:beech", projectName: "Beech" }),
      ],
      onToggle,
    });

    const checkbox = document.querySelector("input[type=checkbox]");
    expect(checkbox).not.toBeNull();
    if (!(checkbox instanceof HTMLInputElement)) {
      throw new Error("expected checkbox input");
    }
    act(() => {
      checkbox.click();
    });

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("p:beech");
  });

  it("surfaces a clear-on-connect warning when a selected candidate has its own alias or AI knowledge URL", () => {
    renderStep({
      candidates: [
        makeCandidate({
          projectId: "p:beech",
          projectName: "Beech",
          projectAlias: "Beech",
          aiKnowledgeUrl: "https://www.notion.so/old",
        }),
      ],
      selectedProjectIds: ["p:beech"],
    });

    expect(document.body.textContent).toContain("Will be cleared on connect");
  });

  it("does not surface the warning when the candidate isn't selected", () => {
    renderStep({
      candidates: [
        makeCandidate({
          projectId: "p:beech",
          projectName: "Beech",
          projectAlias: "Beech",
          aiKnowledgeUrl: "https://www.notion.so/old",
        }),
      ],
      selectedProjectIds: [],
    });

    expect(document.body.textContent).not.toContain(
      "Will be cleared on connect",
    );
  });
});

describe("activationWizardReducer connected-projects state", () => {
  function buildBaseState() {
    return createInitialState(
      [
        {
          projectId: "p:host",
          projectName: "Host",
          suggestedAlias: "Host",
          projectAlias: null,
          postmarkSenderStatus: "unverified",
          connectedToProjectId: null,
          isActive: false,
          primaryEmail: null,
          emailAliases: [],
          additionalEmailCount: 0,
          aiKnowledgeUrl: null,
          aiKnowledgeSyncedAt: null,
          hasCachedAiKnowledge: false,
          memberCount: 0,
          activationRequirementsMet: false,
        },
      ],
      "p:host",
    );
  }

  it("toggle-connected-project adds an id when not selected and removes it when selected", () => {
    const initial = buildBaseState();
    expect(initial.connectedProjectIds).toEqual([]);

    const afterAdd = activationWizardReducer(initial, {
      type: "toggle-connected-project",
      projectId: "p:beech",
    });
    expect(afterAdd.connectedProjectIds).toEqual(["p:beech"]);

    const afterRemove = activationWizardReducer(afterAdd, {
      type: "toggle-connected-project",
      projectId: "p:beech",
    });
    expect(afterRemove.connectedProjectIds).toEqual([]);
  });

  it("supports multiple selections without losing earlier picks", () => {
    const initial = buildBaseState();
    const afterFirst = activationWizardReducer(initial, {
      type: "toggle-connected-project",
      projectId: "p:beech",
    });
    const afterSecond = activationWizardReducer(afterFirst, {
      type: "toggle-connected-project",
      projectId: "p:butternut",
    });

    expect(afterSecond.connectedProjectIds).toEqual(["p:beech", "p:butternut"]);
  });

  it("go-next from step 3 (knowledge) lands on step 4 (connected projects)", () => {
    const stateAtKnowledge = {
      ...buildBaseState(),
      step: 3 as const,
    };

    const afterNext = activationWizardReducer(stateAtKnowledge, {
      type: "go-next",
    });

    expect(afterNext.step).toBe(4);
  });

  it("go-next from step 4 (connected projects) lands on step 5 (review)", () => {
    const stateAtConnected = {
      ...buildBaseState(),
      step: 4 as const,
    };

    const afterNext = activationWizardReducer(stateAtConnected, {
      type: "go-next",
    });

    expect(afterNext.step).toBe(5);
  });

  it("pick-project resets connectedProjectIds back to empty", () => {
    const seeded = {
      ...buildBaseState(),
      connectedProjectIds: ["p:beech"],
    };

    const afterPick = activationWizardReducer(seeded, {
      type: "pick-project",
      project: {
        projectId: "p:other-host",
        projectName: "Other Host",
        suggestedAlias: "Other Host",
        projectAlias: null,
        postmarkSenderStatus: "unverified",
        connectedToProjectId: null,
        isActive: false,
        primaryEmail: null,
        emailAliases: [],
        additionalEmailCount: 0,
        aiKnowledgeUrl: null,
        aiKnowledgeSyncedAt: null,
        hasCachedAiKnowledge: false,
        memberCount: 0,
        activationRequirementsMet: false,
      },
    });

    expect(afterPick.pickedProjectId).toBe("p:other-host");
    expect(afterPick.connectedProjectIds).toEqual([]);
  });
});
