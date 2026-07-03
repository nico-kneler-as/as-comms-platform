import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  ArrowLeft: () => null,
  ArrowRight: () => null,
  CheckCircle2: () => null,
  Clock: () => null,
  Send: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { readonly children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
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

import { ReviewStep } from "../../app/broadcasts/new/_components/review-step";

const baseProps: React.ComponentProps<typeof ReviewStep> = {
  launchType: "normal_email",
  projectChipLabel: "Forests",
  runName: "May forests volunteer update",
  fromEmail: "forests@adventurescientists.org",
  subject: "Gear pickup for Sam",
  selectedSenderVerified: true,
  audienceSize: 1247,
  smsPreviewData: null,
  sendMode: "now",
  scheduleDate: "2026-05-20",
  scheduleTime: "09:30",
  frozen: false,
  frozenState: "draft",
  frozenScheduledAt: null,
  confirmOpen: false,
  submitPending: false,
  onBack: () => undefined,
  onSendModeChange: () => undefined,
  onScheduleDateChange: () => undefined,
  onScheduleTimeChange: () => undefined,
  onConfirmOpenChange: () => undefined,
  onSubmit: () => undefined,
};

describe("ReviewStep sender gating", () => {
  it("renders a lightweight final check without editable sender controls", () => {
    const markup = renderToStaticMarkup(<ReviewStep {...baseProps} />);

    expect(markup).toContain("May forests volunteer update");
    expect(markup).toContain("forests@adventurescientists.org");
    expect(markup).toContain("Final check");
    expect(markup).not.toContain("Choose a verified sender</button>");
    expect(markup).not.toContain("campaign-from-email");
    expect(markup).not.toContain("Re-run");
    expect(markup).not.toContain("Everything you need for tomorrow.");
  });

  it("keeps launch disabled when the root sender verification is false", () => {
    const markup = renderToStaticMarkup(
      <ReviewStep
        {...baseProps}
        fromEmail="pending@adventurescientists.org"
        selectedSenderVerified={false}
      />,
    );

    expect(markup).toMatch(/<button[^>]*disabled[^>]*>[^<]*Send now[^<]*<\/button>/);
  });

  it("keeps launch disabled when no sender has been selected", () => {
    const markup = renderToStaticMarkup(
      <ReviewStep
        {...baseProps}
        fromEmail={null}
        selectedSenderVerified={false}
      />,
    );

    expect(markup).toContain("Choose a verified sender");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>[^<]*Send now[^<]*<\/button>/);
  });

  it("renders SMS review without scheduling controls", () => {
    const markup = renderToStaticMarkup(
      <ReviewStep
        {...baseProps}
        launchType="sms"
        fromEmail={null}
        confirmOpen
        smsPreviewData={{
          selected: 12,
          reachable: 9,
          deduplicatedByPhone: 1,
          frozen: 8,
          unreachable: {
            no_consent: 1,
            revoked: 1,
            no_phone: 1,
          },
          totalSegments: 14,
          estCostUsd: 0.1106,
          sampleBody: "Hi Sam Reply STOP to opt out.",
        }}
      />,
    );

    expect(markup).toContain("reachable of");
    expect(markup).toContain("selected contacts in");
    expect(markup).toContain("≈ 14 segments · ~$0.1106");
    expect(markup).toContain("Send 9 of 12 selected contacts (~14 segments, ~$0.1106)?");
    expect(markup).not.toContain("Schedule for later");
    expect(markup).not.toContain("Choose a verified sender");
  });
});
