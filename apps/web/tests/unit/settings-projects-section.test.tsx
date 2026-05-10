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
  CornerDownRight: () => null,
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
import type {
  ProjectRowViewModel,
  ProjectsSettingsViewModel,
} from "../../src/server/settings/selectors";

function buildRow(
  override: Partial<ProjectRowViewModel> & { readonly projectId: string },
): ProjectRowViewModel {
  return {
    projectName: "Project",
    suggestedAlias: "Project",
    projectAlias: null,
    connectedToProjectId: null,
    isActive: true,
    primaryEmail: null,
    emailAliases: [],
    additionalEmailCount: 0,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null,
    hasCachedAiKnowledge: false,
    memberCount: 0,
    activationRequirementsMet: false,
    ...override,
  };
}

describe("ProjectsSection accessibility", () => {
  it("renders one project-detail link per active project", () => {
    const viewModel: ProjectsSettingsViewModel = {
      isAdmin: true,
      active: [
        {
          host: buildRow({
            projectId: "project:one",
            projectName: "Orca Soundwatch",
            suggestedAlias: "Orca Soundwatch",
            projectAlias: "orca",
            primaryEmail: "orca@example.org",
            emailAliases: ["orca@example.org"],
            memberCount: 3,
            activationRequirementsMet: true,
          }),
          connectedSubProjects: [],
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

  it("nests connected sub-projects under their host with the connected-to subtitle", () => {
    const viewModel: ProjectsSettingsViewModel = {
      isAdmin: true,
      active: [
        {
          host: buildRow({
            projectId: "project:butternut",
            projectName: "Restoring Butternut Tree Health",
            suggestedAlias: "Restoring Butternut Tree Health",
            projectAlias: "forests",
            primaryEmail: "forests@example.org",
            emailAliases: ["forests@example.org"],
            memberCount: 12,
            activationRequirementsMet: true,
          }),
          connectedSubProjects: [
            buildRow({
              projectId: "project:beech",
              projectName: "Saving American Beech",
              suggestedAlias: "Saving American Beech",
              projectAlias: null,
              connectedToProjectId: "project:butternut",
              memberCount: 4,
            }),
          ],
        },
      ],
      inactive: [],
      counts: {
        active: 2,
        inactive: 0,
        total: 2,
      },
    };

    const html = renderToStaticMarkup(
      createElement(ProjectsSection, { viewModel }),
    );

    // Sub renders nested with the sub's link under the host's entry.
    const entryStart = html.indexOf(
      'data-testid="settings-projects-entry"',
    );
    expect(entryStart).toBeGreaterThanOrEqual(0);
    const hostStart = html.indexOf(
      'data-testid="settings-projects-row"',
      entryStart,
    );
    const subStart = html.indexOf(
      'data-testid="settings-projects-connected-sub-row"',
      entryStart,
    );
    expect(hostStart).toBeGreaterThan(entryStart);
    expect(subStart).toBeGreaterThan(hostStart);

    expect(
      html.match(/Connected to Restoring Butternut Tree Health/g),
    ).toHaveLength(1);
    expect(html.includes("No project inbox aliases configured")).toBe(false);
    expect(
      html.match(/href="\/settings\/projects\/project%3Abeech"/g),
    ).toHaveLength(1);
  });
});
