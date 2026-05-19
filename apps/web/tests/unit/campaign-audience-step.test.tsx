import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  Check: () => null,
  CheckCircle2: () => null,
  LoaderCircle: () => null,
  Lock: () => null,
  Search: () => null,
  Sparkles: () => null,
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

const baseProps: React.ComponentProps<typeof AudienceBuilderStep> = {
  availableModes: ["project_status", "specific"],
  criteria: {
    projectId: null,
    projectIds: [],
    statuses: [],
    contactIds: [],
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
  it("renders the initial filter choices", () => {
    const markup = renderToStaticMarkup(<AudienceBuilderStep {...baseProps} />);

    expect(markup).toContain("Project / status");
    expect(markup).toContain("Individual volunteers");
  });

  it("renders the all-approved branch copy for html mode", () => {
    const markup = renderToStaticMarkup(
      <AudienceBuilderStep
        {...baseProps}
        availableModes={["all_approved", "project_status"]}
        criteria={{
          ...baseProps.criteria,
          initialFilter: "all_approved",
        }}
      />,
    );

    expect(markup).toContain("All approved contacts");
    expect(markup).toContain(
      "This broadcast goes to every approved contact across all projects, minus auto-exclusions.",
    );
  });

  it("renders only the project and status surface in project mode", () => {
    const markup = renderToStaticMarkup(
      <AudienceBuilderStep
        {...baseProps}
        projectOptions={[
          {
            id: "project-1",
            name: "Restoring Butternut Forest Health",
            alias: null,
            aliasHint: "forests@",
            connectedToProjectId: "host-project",
            isSubProject: true,
          },
          {
            id: "project-2",
            name: "Saving American Beech",
            alias: null,
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
    expect(markup).toContain("TOP-FUNNEL");
    expect(markup).not.toContain("Search by name or email");
    expect(markup).not.toContain("Find volunteers");
  });

  it("renders only the volunteer search surface in individual mode", () => {
    const markup = renderToStaticMarkup(
      <AudienceBuilderStep
        {...baseProps}
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

  it("disables continue when the live audience is zero", () => {
    const invalidMarkup = renderToStaticMarkup(<AudienceBuilderStep {...baseProps} />);
    const validMarkup = renderToStaticMarkup(
      <AudienceBuilderStep
        {...baseProps}
        criteria={{
          ...baseProps.criteria,
          projectId: "project-1",
          projectIds: ["project-1"],
          statuses: ["Waitlist"],
        }}
        countState={{
          count: 12,
          hasAppliedFilters: true,
        }}
      />,
    );

    expect(invalidMarkup).toMatch(
      /<button[^>]*aria-disabled="true"[^>]*>Continue to compose<\/button>/,
    );
    expect(validMarkup).not.toMatch(
      /<button[^>]*aria-disabled="true"[^>]*>Continue to compose<\/button>/,
    );
  });
});
