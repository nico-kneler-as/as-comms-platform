import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  CheckCircle2: () => null,
  Info: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { readonly children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
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

import { NameAndSenderStep } from "../../app/campaigns/new/_components/name-and-sender-step";

const baseProps: React.ComponentProps<typeof NameAndSenderStep> = {
  name: "May forests volunteer update",
  fromEmail: "forests@adventurescientists.org",
  senderOptions: [
    {
      projectId: "project-1",
      projectName: "Forests",
      projectAliasLabel: "Whitebark Pine",
      email: "forests@adventurescientists.org",
      connectedToProjectId: null,
      status: "verified",
    },
    {
      projectId: "project-2",
      projectName: "Kelp Watch",
      projectAliasLabel: "Kelp Watch",
      email: "kelp@adventurescientists.org",
      connectedToProjectId: null,
      status: "unverified",
    },
  ],
  frozen: false,
  onNameChange: () => undefined,
  onFromEmailChange: () => undefined,
  onBack: () => undefined,
  onContinue: () => undefined,
};

describe("NameAndSenderStep", () => {
  it("renders campaign name and verified-aware sender rows", () => {
    const markup = renderToStaticMarkup(<NameAndSenderStep {...baseProps} />);

    expect(markup).toContain("May forests volunteer update");
    expect(markup).toContain("forests@adventurescientists.org");
    expect(markup).toContain("Whitebark Pine");
    expect(markup).toContain("kelp@adventurescientists.org");
    expect(markup).toContain("Unverified");
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain("This alias hasn&#x27;t been verified in Postmark yet.");
  });
});
