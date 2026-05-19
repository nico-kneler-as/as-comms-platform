import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  CheckCircle2: () => null,
  Search: () => null,
  Sparkles: () => null,
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
  statusOptions: ["Active"],
  onInitialFilterChange: () => undefined,
  onProjectChange: () => undefined,
  onStatusToggle: () => undefined,
  onVolunteerSearchQueryChange: () => undefined,
  onVolunteerToggle: () => undefined,
  onBack: () => undefined,
  onContinue: () => undefined,
};

describe("AudienceBuilderStep initial filter gate", () => {
  it("renders the initial filter choices", () => {
    const markup = renderToStaticMarkup(<AudienceBuilderStep {...baseProps} />);

    expect(markup).toContain("Filter by project/status");
    expect(markup).toContain("Select individual volunteers");
  });
});
