import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  CheckCircle2: () => null,
  ChevronDown: () => null,
  ChevronUp: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: {
    readonly children: React.ReactNode;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    readonly open: boolean;
    readonly children: React.ReactNode;
  }) => (open ? <div data-open="true">{children}</div> : null),
  DialogContent: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { readonly children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { readonly children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { readonly children: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverContent: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
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

import { ReviewStep } from "../../app/campaigns/new/_components/review-step";

const baseProps: React.ComponentProps<typeof ReviewStep> = {
  kind: "project",
  projectChipLabel: "Forests",
  runName: "May forests volunteer update",
  fromEmail: "forests@adventurescientists.org",
  preheader: "Everything you need for tomorrow.",
  senderOptions: [
    {
      projectId: "project-1",
      projectName: "Forests",
      email: "forests@adventurescientists.org",
      connectedToProjectId: null,
      status: "verified",
    },
  ],
  selectedSenderVerified: true,
  audienceSize: 1247,
  previewData: {
    audienceSize: 1247,
    sampleIndex: 0,
    sampleCount: 1247,
    warningCount: 0,
    footerAddress: "123 Research Way • Bozeman, MT, 59715 • USA",
    affectedContacts: [],
    sample: {
      contactId: "contact-1",
      name: "Sam Waters",
      initials: "SW",
      email: "sam@example.org",
      project: "Forests",
      fromEmail: "forests@adventurescientists.org",
      subject: "Gear pickup for Sam Waters",
      html: "<p>Hi Sam Waters,</p><p>See you at the warehouse.</p>",
      text: "Hi Sam Waters",
    },
  },
  previewExpanded: true,
  sendMode: "now",
  scheduleDate: "2026-05-20",
  scheduleTime: "09:30",
  frozen: false,
  frozenState: "draft",
  frozenScheduledAt: null,
  confirmOpen: false,
  submitPending: false,
  onRunNameChange: () => undefined,
  onFromEmailChange: () => undefined,
  onBack: () => undefined,
  onRerunAudience: () => undefined,
  onPreviewExpandedChange: () => undefined,
  onSendModeChange: () => undefined,
  onScheduleDateChange: () => undefined,
  onScheduleTimeChange: () => undefined,
  onConfirmOpenChange: () => undefined,
  onSubmit: () => undefined,
};

describe("ReviewStep sender gating", () => {
  it("shows verified senders and leaves launch enabled", () => {
    const markup = renderToStaticMarkup(<ReviewStep {...baseProps} />);

    expect(markup).toContain("forests@adventurescientists.org · verified");
    expect(markup).not.toContain("<button disabled=\"\">Send now</button>");
  });

  it("renders unverified sender rows as disabled with verification guidance", () => {
    const markup = renderToStaticMarkup(
      <ReviewStep
        {...baseProps}
        fromEmail={null}
        selectedSenderVerified={false}
        senderOptions={[
          ...baseProps.senderOptions,
          {
            projectId: "project-2",
            projectName: "Kelp Watch",
            email: "kelp@adventurescientists.org",
            connectedToProjectId: null,
            status: "unverified",
          },
        ]}
      />,
    );

    expect(markup).toContain("kelp@adventurescientists.org · unverified");
    expect(markup).toContain("aria-disabled=\"true\"");
    expect(markup).toContain(
      "This alias hasn&#x27;t been verified in Postmark yet. Open Settings → Projects to start verification.",
    );
    expect(markup).toContain(
      "aria-label=\"kelp@adventurescientists.org · unverified. This alias hasn&#x27;t been verified in Postmark yet. Open Settings → Projects to start verification.\"",
    );
  });

  it("keeps launch disabled when only unverified senders exist", () => {
    const markup = renderToStaticMarkup(
      <ReviewStep
        {...baseProps}
        fromEmail={null}
        selectedSenderVerified={false}
        senderOptions={[
          {
            projectId: "project-2",
            projectName: "Kelp Watch",
            email: "kelp@adventurescientists.org",
            connectedToProjectId: null,
            status: "unverified",
          },
        ]}
      />,
    );

    expect(markup).toContain("<button disabled=\"\">Send now</button>");
  });
});
