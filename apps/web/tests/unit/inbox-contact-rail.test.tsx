import { createRequire } from "node:module";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxContactSummaryViewModel } from "../../app/inbox/_lib/view-models";

Object.assign(globalThis, { React });

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement("button", props, children),
}));

vi.mock("@/components/ui/section-label", () => ({
  SectionLabel: ({
    children,
  }: {
    readonly children?: React.ReactNode;
    readonly as?: string;
  }) => createElement("span", null, children),
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ label }: { readonly label: string }) =>
    createElement("span", null, label),
}));

vi.mock("@/app/_lib/design-tokens", () => ({
  PROJECT_STATUS_BADGE: {
    lead: "",
    applied: "",
    "in-training": "",
    "trip-planning": "",
    "in-field": "",
    successful: "",
  },
}));

vi.mock("@/app/_lib/design-tokens-v2", () => ({
  LAYOUT: {
    railWidth: "w-80",
    headerHeight: "h-[54px]",
  },
  SPACING: {
    section: "px-5 py-4",
  },
  TONE_CLASSES: {
    slate: {
      subtle: "bg-slate-50",
    },
    sky: {
      dot: "bg-sky-500",
    },
  },
  TYPE: {
    headingSm: "text-sm font-semibold text-slate-900",
  },
}));

vi.mock("../../app/inbox/_components/icons", () => ({
  CalendarIcon: () => createElement("svg"),
  MailIcon: () => createElement("svg"),
  PanelRightCloseIcon: () => createElement("svg"),
  PhoneIcon: () => createElement("svg"),
}));

vi.mock("lucide-react", () => ({
  ExternalLink: () => createElement("svg"),
}));

import { InboxContactRail } from "../../app/inbox/_components/inbox-contact-rail";

const workerRequire = createRequire(
  new URL("../../../worker/package.json", import.meta.url),
);
const { JSDOM } = workerRequire("jsdom") as {
  readonly JSDOM: new (
    html: string,
    options: { readonly url: string },
  ) => {
    readonly window: Window &
      typeof globalThis & {
        close: () => void;
      };
  };
};

interface RenderSession {
  readonly container: HTMLElement;
  readonly root: Root;
  readonly cleanup: () => Promise<void>;
}

let activeSession: RenderSession | null = null;

function setDomGlobals(window: Window & typeof globalThis) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: window,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: window.document,
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: window.HTMLElement,
  });
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    value: window.Node,
  });
  Object.defineProperty(globalThis, "Event", {
    configurable: true,
    value: window.Event,
  });
  Object.defineProperty(globalThis, "MouseEvent", {
    configurable: true,
    value: window.MouseEvent,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: window.navigator,
  });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
}

function buildContact(activityCount: number): InboxContactSummaryViewModel {
  return {
    contactId: "contact:sarah-martinez",
    displayName: "Sarah Martinez",
    volunteerId: "VOL-001",
    primaryEmail: "sarah@example.org",
    primaryPhone: "555-0100",
    joinedAtLabel: "Joined Apr 2024",
    hasUnresolved: false,
    pinnedNote: null,
    activeProjects: [],
    pastProjects: [],
    recentActivity: Array.from({ length: activityCount }, (_, index) => ({
      id: `activity-${(index + 1).toString()}`,
      label: `Lifecycle event ${(index + 1).toString()}`,
      occurredAtLabel: `Apr ${(index + 1).toString()}`,
    })),
  };
}

async function renderRail(
  contact: InboxContactSummaryViewModel,
): Promise<RenderSession> {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/inbox",
  });
  setDomGlobals(dom.window);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(InboxContactRail, { contact }));
    await Promise.resolve();
  });

  return {
    container,
    root,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.remove();
      dom.window.close();
    },
  };
}

async function click(element: Element | null) {
  if (element === null) {
    throw new Error("Expected clickable element");
  }

  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

afterEach(async () => {
  await activeSession?.cleanup();
  activeSession = null;
});

describe("InboxContactRail", () => {
  it("shows five activity items by default and toggles the full list open and closed", async () => {
    activeSession = await renderRail(buildContact(8));

    expect(activeSession.container.textContent).toContain("Show all (8)");
    expect(
      activeSession.container.querySelectorAll("section:last-of-type ul li").length,
    ).toBe(5);
    expect(activeSession.container.textContent).not.toContain("Lifecycle event 6");

    await click(
      Array.from(activeSession.container.querySelectorAll("button")).find(
        (element) => element.textContent === "Show all (8)",
      ) ?? null,
    );

    expect(activeSession.container.textContent).toContain("Show less");
    expect(
      activeSession.container.querySelectorAll("section:last-of-type ul li").length,
    ).toBe(8);
    expect(activeSession.container.textContent).toContain("Lifecycle event 8");

    await click(
      Array.from(activeSession.container.querySelectorAll("button")).find(
        (element) => element.textContent === "Show less",
      ) ?? null,
    );

    expect(activeSession.container.textContent).toContain("Show all (8)");
    expect(
      activeSession.container.querySelectorAll("section:last-of-type ul li").length,
    ).toBe(5);
    expect(activeSession.container.textContent).not.toContain("Lifecycle event 6");
  });

  it("highlights the explicitly most recent lifecycle item instead of assuming the first row is newest", async () => {
    activeSession = await renderRail({
      ...buildContact(2),
      recentActivity: [
        {
          id: "activity-1",
          label: "Signed up",
          occurredAtLabel: "Apr 8",
        },
        {
          id: "activity-2",
          label: "Submitted first data",
          occurredAtLabel: "Apr 11",
          isMostRecent: true,
        },
      ],
    });

    const items = Array.from(
      activeSession.container.querySelectorAll("section:last-of-type ul li"),
    );
    const firstDot = items[0]?.querySelector("div.rounded-full");
    const secondDot = items[1]?.querySelector("div.rounded-full");

    expect(firstDot?.className).toContain("border-slate-300");
    expect(secondDot?.className).toContain("border-sky-500");
  });

  it("renders past project name and status", async () => {
    activeSession = await renderRail({
      ...buildContact(0),
      pastProjects: [
        {
          membershipId: "membership-1",
          projectId: "project-1",
          projectName: "Alpine Stream Survey",
          subDisplayName: null,
          isConnectedSub: false,
          expeditionMemberUrl: null,
          crmUrl: "https://salesforce.example.com/member/1",
          projectIsActive: false,
          status: "successful",
          statusLabel: "Successful",
        },
      ],
    });

    expect(activeSession.container.textContent).toContain("Alpine Stream Survey");
    expect(activeSession.container.textContent).toContain("Successful");
  });

  // PR for connected-projects host/sub label: a Beech-only volunteer's
  // active project rolls up under a "Forests" host. The rail must show
  // the host's display name as primary, with a small "via {sub}" line
  // beneath it so the operator can still see which Salesforce project
  // the contact actually rolled up from.
  it("renders the host name as primary and 'via {sub}' as secondary for a connected sub project", async () => {
    activeSession = await renderRail({
      ...buildContact(0),
      activeProjects: [
        {
          membershipId: "membership-beech",
          projectId: "project:beech",
          projectName: "Beech & Butternut",
          subDisplayName: "Saving American Beech",
          isConnectedSub: true,
          expeditionMemberUrl:
            "https://salesforce.example.com/member/beech-1",
          crmUrl: "https://salesforce.example.com/project/beech-1",
          projectIsActive: true,
          status: "in-field",
          statusLabel: "In field",
        },
      ],
    });

    expect(activeSession.container.textContent).toContain(
      "Beech & Butternut",
    );
    expect(activeSession.container.textContent).toContain(
      "via Saving American Beech",
    );
  });

  it("does not render 'via …' for a standalone (non-connected) active project", async () => {
    activeSession = await renderRail({
      ...buildContact(0),
      activeProjects: [
        {
          membershipId: "membership-standalone",
          projectId: "project:whitebark",
          projectName: "Whitebark Pines",
          subDisplayName: null,
          isConnectedSub: false,
          expeditionMemberUrl:
            "https://salesforce.example.com/member/whitebark-1",
          crmUrl: "https://salesforce.example.com/project/whitebark-1",
          projectIsActive: true,
          status: "in-field",
          statusLabel: "In field",
        },
      ],
    });

    expect(activeSession.container.textContent).toContain("Whitebark Pines");
    expect(activeSession.container.textContent).not.toContain("via ");
  });
});
