import React, { createElement, type ButtonHTMLAttributes } from "react";

// Compiled JSX in imported components uses React.createElement under the
// classic runtime; expose React on globalThis before any app-module
// imports run so the imported component can find it at render time.
Object.assign(globalThis, { React });
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
  }: {
    readonly children: unknown;
  }) => children,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("lucide-react", () => ({
  ArrowLeft: () => null,
  Check: () => null,
  ChevronRight: () => null,
  Circle: () => null,
  FolderOpen: () => null,
  Loader2: () => null,
  Mail: () => null,
  Pencil: () => null,
  Plus: () => null,
  RefreshCw: () => null,
  Search: () => null,
  SlidersHorizontal: () => null,
  Sparkles: () => null,
  Trash2: () => null,
  UserPlus: () => null,
  X: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement> & {
    readonly size?: string;
    readonly variant?: string;
  }) => {
    const { children, size, variant, ...buttonProps } = props;
    void size;
    void variant;
    return createElement("button", buttonProps, children);
  },
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => createElement("input", props),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
  }: {
    readonly children: unknown;
  }) => children,
  DialogContent: ({
    children,
  }: {
    readonly children: unknown;
  }) => children,
  DialogDescription: ({
    children,
  }: {
    readonly children: unknown;
  }) => children,
  DialogFooter: ({
    children,
  }: {
    readonly children: unknown;
  }) => children,
  DialogHeader: ({
    children,
  }: {
    readonly children: unknown;
  }) => children,
  DialogTitle: ({
    children,
  }: {
    readonly children: unknown;
  }) => children,
}));

vi.mock("../../app/settings/actions", () => ({
  deleteProjectKnowledgeAction: vi.fn(),
  deleteProjectKnowledgeSourceLinkAction: vi.fn(),
  setProjectKnowledgeApprovedAction: vi.fn(),
  triggerBootstrapAction: vi.fn(),
  updateProjectKnowledgeAction: vi.fn(),
  upsertProjectKnowledgeSourceLinkAction: vi.fn(),
}));

import { ProjectKnowledgeTable } from "../../app/settings/_components/project-knowledge-table";

const run = {
  id: "run:alpha",
  status: "done" as const,
  force: false,
  startedAt: "2026-04-24T12:00:00.000Z",
  completedAt: "2026-04-24T12:05:00.000Z",
  stats: {
    sourcesFetched: 1,
    topicsFound: 2,
    candidatesWritten: 2,
    costEstimateUsd: 0.0123,
    budgetWarn: true,
  },
  errorDetail: null,
};

describe("settings knowledge sources UI", () => {
  it("renders source CRUD controls, bootstrap trigger, and recent run status", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectKnowledgeTable, {
        projectId: "project:alpha",
        projectName: "Project Alpha",
        entries: [],
        sourceLinks: [
          {
            id: "source:alpha",
            kind: "public_project_page",
            label: "Public page",
            url: "https://example.org/project-alpha",
            createdAt: "2026-04-24T11:00:00.000Z",
            updatedAt: "2026-04-24T11:00:00.000Z",
          },
        ],
        runs: [run],
      }),
    );

    expect(html).toContain("Knowledge Sources");
    expect(html).toContain("Generate baseline knowledge");
    expect(html).toContain("Public page");
    expect(html).toContain("https://example.org/project-alpha");
    expect(html).toContain("Recent runs");
    expect(html).toContain("budget warn");
    expect(html).toContain("$0.0123");
  });

  it("disables bootstrap when no knowledge sources exist", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectKnowledgeTable, {
        projectId: "project:alpha",
        projectName: "Project Alpha",
        entries: [],
        sourceLinks: [],
        runs: [],
      }),
    );

    expect(html).toContain("No knowledge sources have been added.");
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("Generate baseline knowledge");
  });

  it("includes the large-entry confirmation copy for confirmed bootstrap runs", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectKnowledgeTable, {
        projectId: "project:alpha",
        projectName: "Project Alpha",
        entries: Array.from({ length: 51 }, (_, index) => ({
          id: `entry:${String(index)}`,
          kind: "snippet" as const,
          issueType: "training",
          volunteerStage: null,
          questionSummary: `Existing question ${String(index)}`,
          replyStrategy: null,
          maskedExample: null,
          sourceKind: "hand_authored" as const,
          approvedForAi: false,
          lastReviewedAt: null,
          createdAt: "2026-04-24T11:00:00.000Z",
          updatedAt: "2026-04-24T11:00:00.000Z",
        })),
        sourceLinks: [
          {
            id: "source:alpha",
            kind: "training_site",
            label: "Training",
            url: "https://example.org/training",
            createdAt: "2026-04-24T11:00:00.000Z",
            updatedAt: "2026-04-24T11:00:00.000Z",
          },
        ],
        runs: [],
      }),
    );

    expect(html).toContain("This project already has more than 50 knowledge entries.");
    expect(html).toContain("Generated entries will be added as unapproved candidates.");
  });
});
