import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  CheckCircle2: () => null,
  ChevronDown: () => null,
  Sparkles: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { readonly children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { readonly children: React.ReactNode }) => (
    <>{children}</>
  ),
  Tooltip: ({ children }: { readonly children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({ children }: { readonly children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { readonly children: React.ReactNode }) => (
    <div data-tooltip="true">{children}</div>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({
    children,
  }: {
    readonly children: React.ReactNode;
  }) => <div>{children}</div>,
  DropdownMenuTrigger: ({
    children,
  }: {
    readonly children: React.ReactNode;
  }) => <>{children}</>,
}));

vi.mock("@/components/ui/toggle-group", () => ({
  ToggleGroup: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ToggleGroupItem: ({
    children,
    ...props
  }: {
    readonly children: React.ReactNode;
  }) => <button {...props}>{children}</button>,
}));

import { AudienceBuilderStep } from "../../app/campaigns/new/_components/audience-builder-step";

const baseProps: React.ComponentProps<typeof AudienceBuilderStep> = {
  criteria: {
    projectIds: [],
    statuses: [],
    expeditionIds: [],
    lastActivityWindow: "all_time",
    hasReplied: "either",
    hasClicked: "either",
    initialFilter: "project_status",
  },
  countState: {
    count: 0,
    hasAppliedFilters: false,
  },
  previewRows: [],
  countLoading: false,
  previewLoading: false,
  previewOpen: false,
  previewErrorMessage: null,
  projectGroups: [],
  expeditionOptions: [],
  statusOptions: ["Active"],
  isAdmin: true,
  onInitialFilterChange: () => undefined,
  onProjectToggle: () => undefined,
  onStatusToggle: () => undefined,
  onExpeditionToggle: () => undefined,
  onLastActivityChange: () => undefined,
  onHasRepliedChange: () => undefined,
  onHasClickedChange: () => undefined,
  onPreviewToggle: () => undefined,
  onBack: () => undefined,
  onContinue: () => undefined,
};

describe("AudienceBuilderStep initial filter gate", () => {
  it("renders the initial filter choices", () => {
    const markup = renderToStaticMarkup(<AudienceBuilderStep {...baseProps} />);

    expect(markup).toContain("All approved contacts");
    expect(markup).toContain("Filter by project and status");
    expect(markup).toContain("Specific recipients");
  });

  it("disables all approved contacts for non-admins", () => {
    const markup = renderToStaticMarkup(
      <AudienceBuilderStep {...baseProps} isAdmin={false} />,
    );

    expect(markup).toContain("Newsletter sends are admin-only");
    expect(markup).toContain('disabled=""');
  });
});
