import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children
  }: {
    readonly children: unknown;
  }) => children
}));

vi.mock("lucide-react", () => ({
  ArrowLeft: () => null,
  Check: () => null,
  ChevronRight: () => null,
  Circle: () => null,
  Flag: () => null,
  FolderOpen: () => null,
  Inbox: () => null,
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
  Sparkles: () => null,
  Trash2: () => null,
  UserPlus: () => null,
  X: () => null
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children
  }: {
    readonly children: unknown;
  }) => children
}));

vi.mock("@/components/ui/input", () => ({
  Input: () => null
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children
  }: {
    readonly children: unknown;
  }) => children,
  DialogContent: ({
    children
  }: {
    readonly children: unknown;
  }) => children,
  DialogDescription: ({
    children
  }: {
    readonly children: unknown;
  }) => children,
  DialogFooter: ({
    children
  }: {
    readonly children: unknown;
  }) => children,
  DialogHeader: ({
    children
  }: {
    readonly children: unknown;
  }) => children,
  DialogTitle: ({
    children
  }: {
    readonly children: unknown;
  }) => children,
  DialogTrigger: ({
    children
  }: {
    readonly children: unknown;
  }) => children
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({
    label
  }: {
    readonly label: string;
  }) => label
}));

vi.mock("../../app/settings/actions", () => ({
  activateProjectAction: vi.fn(),
  deactivateProjectAction: vi.fn(),
  updateProjectAliasAction: vi.fn(),
  updateProjectAliasSignatureAction: vi.fn(),
  updateProjectAiKnowledgeAction: vi.fn(),
  updateProjectEmailsAction: vi.fn()
}));

import { ProjectDetail } from "../../app/settings/_components/project-detail";

describe("ProjectDetail role-aware rendering", () => {
  it("does not render mutation controls for non-admin users", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectDetail, {
        project: {
          projectId: "project:inactive",
          projectName: "Inactive Project",
          suggestedAlias: "Inactive Project",
          projectAlias: null,
          isActive: false,
          primaryEmail: "inactive@asc.internal",
          emailAliases: ["inactive@asc.internal"],
          additionalEmailCount: 0,
          aiKnowledgeUrl: null,
          aiKnowledgeSyncedAt: null,
          memberCount: 0,
          activationRequirementsMet: false,
          isAdmin: false,
          emails: [
            {
              id: "alias:inactive",
              address: "inactive@asc.internal",
              isPrimary: true,
              signature: ""
            }
          ],
          salesforceProjectId: "project:inactive"
        }
      })
    );

    expect(html).toContain("Inbox aliases");
    expect(html).not.toContain("Activate project");
    expect(html).not.toContain("Deactivate project");
    expect(html).not.toContain("Add alias");
    expect(html).not.toContain("Save alias");
    expect(html).not.toContain("Save URL");
    expect(html).not.toContain("Sync");
    expect(html).not.toContain("Make primary");
    expect(html).not.toContain("Save signature");
  });
});
