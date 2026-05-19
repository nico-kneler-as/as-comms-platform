import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  CheckCircle2: () => null,
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
  projectGroups: [],
  statusOptions: ["Waitlist"],
  statusCounts: {},
  statusCountsErrorMessage: null,
  onInitialFilterChange: () => undefined,
  onProjectChange: () => undefined,
  onSelectAllStatuses: () => undefined,
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
});
