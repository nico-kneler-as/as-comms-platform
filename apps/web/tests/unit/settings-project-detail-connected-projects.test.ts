import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href
  }: {
    readonly children: unknown;
    readonly href?: string;
  }) =>
    createElement(
      "a",
      { href: typeof href === "string" ? href : undefined },
      children as never
    )
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn()
  })
}));

vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  ArrowLeft: () => null,
  BookOpen: () => null,
  Check: () => null,
  ChevronRight: () => null,
  Circle: () => null,
  Flag: () => null,
  FolderOpen: () => null,
  Inbox: () => null,
  Link2: () => null,
  Link2Off: () => null,
  Loader2: () => null,
  Mail: () => null,
  MailOpen: () => null,
  Pencil: () => null,
  Plus: () => null,
  RefreshCw: () => null,
  RotateCw: () => null,
  Search: () => null,
  Send: () => null,
  SlidersHorizontal: () => null,
  Sparkle: () => null,
  Sparkles: () => null,
  Trash2: () => null,
  UserPlus: () => null,
  X: () => null
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { readonly children: unknown }) => children as never
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ value }: { readonly value?: string }) =>
    createElement("input", { defaultValue: value })
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { readonly children: unknown }) => children as never,
  DialogContent: ({ children }: { readonly children: unknown }) =>
    children as never,
  DialogDescription: ({ children }: { readonly children: unknown }) =>
    children as never,
  DialogFooter: ({ children }: { readonly children: unknown }) =>
    children as never,
  DialogHeader: ({ children }: { readonly children: unknown }) =>
    children as never,
  DialogTitle: ({ children }: { readonly children: unknown }) =>
    children as never,
  DialogTrigger: ({ children }: { readonly children: unknown }) =>
    children as never
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ label }: { readonly label: string }) => label
}));

vi.mock("../../app/settings/_components/project-ai-knowledge-section", () => ({
  ProjectAiKnowledgeSection: () =>
    createElement("section", null, "AI Knowledge section")
}));

vi.mock("../../app/settings/actions", () => ({
  activateProjectAction: vi.fn(),
  addAiKnowledgeSourceAction: vi.fn(),
  deactivateProjectAction: vi.fn(),
  disconnectProjectAction: vi.fn(),
  removeAiKnowledgeSourceAction: vi.fn(),
  setProjectConnectedProjectsAction: vi.fn(),
  syncOneAiKnowledgeSourceAction: vi.fn(),
  submitWizardAiKnowledgeSourcesAction: vi.fn(),
  triggerProjectKnowledgeSynthesisAction: vi.fn(),
  updateAiAutoSyncScheduleAction: vi.fn(),
  updateProjectAliasAction: vi.fn(),
  updateProjectAliasSignatureAction: vi.fn(),
  updateAiKnowledgeSourceAction: vi.fn(),
  updateProjectEmailsAction: vi.fn(),
  updateOperatingContextAction: vi.fn()
}));

import { ProjectDetail } from "../../app/settings/_components/project-detail";
import type { ProjectSettingsDetailViewModel } from "../../src/server/settings/selectors";

function makeProject(
  overrides: Partial<ProjectSettingsDetailViewModel> = {}
): ProjectSettingsDetailViewModel {
  const base: ProjectSettingsDetailViewModel = {
    projectId: "host:forests",
    projectName: "Forests",
    suggestedAlias: "Forests",
    projectAlias: "Forests",
    postmarkSenderStatus: "unverified",
    connectedToProjectId: null,
    isActive: true,
    primaryEmail: "forests@adventurescientists.org",
    emailAliases: ["forests@adventurescientists.org"],
    additionalEmailCount: 0,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null,
    hasCachedAiKnowledge: false,
    aiKnowledgeSources: [],
    aiOperatingContext: "",
    aiAutoSyncSchedule: "never",
    aiOptimizedSynthesizedAt: null,
    aiOptimizedLastCheckedAt: null,
    aiOptimizedInputHash: null,
    aiKnowledgeSynthesisStale: false,
    memberCount: 5,
    activationRequirementsMet: true,
    isAdmin: true,
    emails: [
      {
        id: "alias:forests",
        address: "forests@adventurescientists.org",
        isPrimary: true,
        signature: "Warmly,\nForests Team\nAdventure Scientists"
      }
    ],
    salesforceProjectId: "host:forests",
    connectedProjects: [],
    connectedToHost: null,
    availableConnectionCandidates: []
  };

  return { ...base, ...overrides };
}

describe("ProjectDetail — host with connected sub-projects", () => {
  it("renders the connected-projects card with each sub's name and Disconnect control", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectDetail, {
        project: makeProject({
          connectedProjects: [
            { projectId: "sub:beech", projectName: "Beech" },
            { projectId: "sub:butternut", projectName: "Butternut" }
          ]
        })
      })
    );

    expect(html).toContain("Connected projects");
    expect(html).toContain("Beech");
    expect(html).toContain("Butternut");
    // The host view exposes a per-row Disconnect button (rendered in the
    // section component) as well as the section's Add affordance.
    expect(html).toContain("Disconnect");
    expect(html).toContain("Add");
  });

  it("renders an empty state when the host has zero connected sub-projects", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectDetail, {
        project: makeProject({
          connectedProjects: []
        })
      })
    );

    expect(html).toContain("No connected projects.");
  });
});

describe("ProjectDetail — connected sub-project", () => {
  it("renders a 'Connected to {host}' badge linking to the host's settings page", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectDetail, {
        project: makeProject({
          projectId: "sub:beech",
          projectName: "Beech",
          projectAlias: null,
          connectedToProjectId: "host:forests",
          aiKnowledgeUrl: null,
          connectedToHost: {
            projectId: "host:forests",
            projectName: "Forests",
            projectAlias: "Forests",
            aiKnowledgeUrl: null
          }
        })
      })
    );

    expect(html).toContain("Connected to Forests");
    expect(html).toContain('href="/settings/projects/host%3Aforests"');
  });

  it("renders the alias and AI Knowledge as inherited (read-only) for a sub-project", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectDetail, {
        project: makeProject({
          projectId: "sub:beech",
          projectName: "Beech",
          projectAlias: null,
          connectedToProjectId: "host:forests",
          connectedToHost: {
            projectId: "host:forests",
            projectName: "Forests",
            projectAlias: "Forests",
            aiKnowledgeUrl: "https://www.notion.so/forests"
          }
        })
      })
    );

    // Alias section now reads "Inherited from Forests" instead of an editable
    // input + Save button.
    expect(html).toContain("Inherited from");
    expect(html).toContain("AI Knowledge is inherited from");
    expect(html).not.toContain("AI Knowledge section");
  });

  it("renders a Disconnect control for connected sub-projects", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectDetail, {
        project: makeProject({
          projectId: "sub:beech",
          projectName: "Beech",
          projectAlias: null,
          connectedToProjectId: "host:forests",
          connectedToHost: {
            projectId: "host:forests",
            projectName: "Forests",
            projectAlias: "Forests",
            aiKnowledgeUrl: null
          }
        })
      })
    );

    expect(html).toContain("Disconnect from Forests");
  });
});

describe("ProjectDetail — cascade-deactivation dialog", () => {
  it("lists connected sub-projects in the deactivate dialog when the host has subs", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectDetail, {
        project: makeProject({
          connectedProjects: [
            { projectId: "sub:beech", projectName: "Beech" },
            { projectId: "sub:butternut", projectName: "Butternut" }
          ]
        })
      })
    );

    // The dialog body lists each cascading sub-project by name.
    expect(html).toContain("connected sub-project");
    expect(html).toContain("Beech");
    expect(html).toContain("Butternut");
    // Button label still reads "Deactivate project".
    expect(html).toContain("Deactivate project");
  });

  it("uses the standard description (no cascade) when the host has zero subs", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectDetail, {
        project: makeProject({
          connectedProjects: []
        })
      })
    );

    expect(html).toContain(
      "This will hide the project from the active list."
    );
    expect(html).not.toContain("connected sub-project");
  });
});
