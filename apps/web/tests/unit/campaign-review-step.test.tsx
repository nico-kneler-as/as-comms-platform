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

import { ReviewStep } from "../../app/campaigns/new/_components/review-step";

const baseProps: React.ComponentProps<typeof ReviewStep> = {
  kind: "project",
  projectChipLabel: "Forests",
  runName: null,
  fromEmail: "forests@adventurescientists.org",
  preheader: "Everything you need for tomorrow.",
  senderOptions: [
    {
      projectId: "project-1",
      projectName: "Forests",
      email: "forests@adventurescientists.org",
      connectedToProjectId: null,
    },
  ],
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

describe("ReviewStep snapshots", () => {
  it("renders the editable review state", () => {
    expect(
      renderToStaticMarkup(
        <ReviewStep
          {...baseProps}
          runName="May forests volunteer update"
          confirmOpen={true}
        />,
      ),
    ).toMatchSnapshot();
  });

  it("renders the frozen scheduled state", () => {
    expect(
      renderToStaticMarkup(
        <ReviewStep
          {...baseProps}
          runName="May forests volunteer update"
          frozen={true}
          frozenState="scheduled"
          frozenScheduledAt="2026-05-20T15:30:00.000Z"
          previewExpanded={false}
        />,
      ),
    ).toMatchSnapshot();
  });
});
