import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  ArrowLeft: () => null,
  ArrowRight: () => null,
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

import { NameAndSenderStep } from "../../app/broadcasts/new/_components/name-and-sender-step";

const baseProps: React.ComponentProps<typeof NameAndSenderStep> = {
  launchType: "normal_email",
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
      senderType: "project",
    },
    {
      projectId: "project-2",
      projectName: "Kelp Watch",
      projectAliasLabel: "Kelp Watch",
      email: "kelp@adventurescientists.org",
      connectedToProjectId: null,
      status: "unverified",
      senderType: "project",
    },
    {
      projectId: null,
      projectName: "Adventure Scientists",
      projectAliasLabel: "Adventure Scientists",
      email: "info@adventurescientists.org",
      connectedToProjectId: null,
      status: "verified",
      senderType: "org",
    },
  ],
  activeSmsSender: {
    id: "sms-sender-1",
    displayName: "Adventure Scientists",
    phoneE164: "+14065550199",
  },
  frozen: false,
  onNameChange: () => undefined,
  onFromEmailChange: () => undefined,
  onBack: () => undefined,
  onContinue: () => undefined,
};

describe("NameAndSenderStep", () => {
  it("renders broadcast name and verified-aware sender rows", () => {
    const markup = renderToStaticMarkup(<NameAndSenderStep {...baseProps} />);

    expect(markup).toContain("May forests volunteer update");
    expect(markup).toContain("forests@adventurescientists.org");
    expect(markup).toContain("Whitebark Pine");
    expect(markup).toContain("Project aliases");
    expect(markup).toContain("Organization");
    expect(markup).toContain("kelp@adventurescientists.org");
    expect(markup).toContain("info@adventurescientists.org");
    expect(markup).toContain("Unverified");
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain(
      "This alias hasn&#x27;t been verified in Postmark yet.",
    );
    expect(markup).toContain("Continue");
  });

  it("disables continue until both the name and sender are present", () => {
    const invalidMarkup = renderToStaticMarkup(
      <NameAndSenderStep {...baseProps} name="   " fromEmail={null} />,
    );
    const validMarkup = renderToStaticMarkup(
      <NameAndSenderStep {...baseProps} />,
    );

    expect(invalidMarkup).toMatch(
      /<button[^>]*aria-disabled="true"[^>]*>Continue<\/button>/,
    );
    expect(validMarkup).not.toMatch(
      /<button[^>]*aria-disabled="true"[^>]*>Continue<\/button>/,
    );
  });

  it("shows the active SMS sender and only requires the campaign name", () => {
    const smsMarkup = renderToStaticMarkup(
      <NameAndSenderStep {...baseProps} launchType="sms" fromEmail={null} />,
    );
    const missingSenderMarkup = renderToStaticMarkup(
      <NameAndSenderStep
        {...baseProps}
        launchType="sms"
        name="SMS update"
        fromEmail={null}
        activeSmsSender={null}
      />,
    );

    expect(smsMarkup).toContain("Adventure Scientists");
    expect(smsMarkup).toContain("+14065550199");
    expect(smsMarkup).toContain("Sends from");
    expect(smsMarkup).not.toMatch(
      /<button[^>]*aria-disabled="true"[^>]*>Continue<\/button>/,
    );
    expect(missingSenderMarkup).toContain("No active SMS sender configured.");
    expect(missingSenderMarkup).toMatch(
      /<button[^>]*aria-disabled="true"[^>]*>Continue<\/button>/,
    );
  });
});
