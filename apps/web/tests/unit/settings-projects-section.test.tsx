import * as React from "react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    readonly children: ReactNode;
    readonly href: string;
  }) => createElement("a", { href, ...props }, children),
}));

vi.mock("lucide-react", () => ({
  FolderOpen: () => null,
  Plus: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: {
    readonly children: ReactNode;
  }) => createElement("button", props, children),
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ label }: { readonly label: string }) =>
    createElement("span", null, label),
}));

vi.mock("../../app/settings/_components/activation-wizard", () => ({
  ActivationWizard: () => null,
}));

import { ProjectsSection } from "../../app/settings/_components/projects-section";
import type { ProjectsSettingsViewModel } from "../../src/server/settings/selectors";

describe("ProjectsSection accessibility", () => {
  it("renders one project-detail link per active project", () => {
    const viewModel: ProjectsSettingsViewModel = {
      isAdmin: true,
      active: [
        {
          projectId: "project:one",
          projectName: "Orca Soundwatch",
          suggestedAlias: "Orca Soundwatch",
          projectAlias: "orca",
          connectedToProjectId: null,
          isActive: true,
          primaryEmail: "orca@example.org",
          emailAliases: ["orca@example.org"],
          additionalEmailCount: 0,
          aiKnowledgeUrl: null,
          aiKnowledgeSyncedAt: null,
          hasCachedAiKnowledge: false,
          memberCount: 3,
          activationRequirementsMet: true,
        },
      ],
      inactive: [],
      counts: {
        active: 1,
        inactive: 0,
        total: 1,
      },
    };

    const html = renderToStaticMarkup(
      createElement(ProjectsSection, { viewModel }),
    );

    expect(
      html.match(/href="\/settings\/projects\/project%3Aone"/g),
    ).toHaveLength(1);
    expect(html.match(/aria-label="Open Orca Soundwatch"/g)).toHaveLength(1);
  });
});
