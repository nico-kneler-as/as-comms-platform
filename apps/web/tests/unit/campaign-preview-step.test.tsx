import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  ChevronLeft: () => null,
  ChevronRight: () => null,
  Info: () => null,
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
  DialogHeader: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { readonly children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

import { PreviewStep } from "../../app/campaigns/new/_components/preview-step";

const baseProps: React.ComponentProps<typeof PreviewStep> = {
  subject: "Gear pickup for {{firstName}}",
  preheader: "Everything you need for tomorrow.",
  previewData: {
    audienceSize: 24,
    sampleIndex: 0,
    sampleCount: 24,
    warningCount: 0,
    footerAddress: "123 Research Way, Bozeman, MT, 59715, USA",
    affectedContacts: [],
    sample: {
      contactId: "contact-1",
      name: "Sam Waters",
      initials: "SW",
      email: "sam@example.org",
      project: "Forests",
      fromEmail: "forests@adventurescientists.org",
      subject: "Gear pickup for Sam",
      html: "<p>Hi Sam,</p><p>See you at the warehouse.</p>",
      text: "Hi Sam",
    },
  },
  previewLoading: false,
  warningDismissed: false,
  affectedContactsOpen: false,
  testSendOpen: false,
  testRecipientEmail: "nico@adventurescientists.org",
  testSendPending: false,
  selectedSenderVerified: true,
  frozen: false,
  onBack: () => undefined,
  onContinue: () => undefined,
  onPreviewPrevious: () => undefined,
  onPreviewNext: () => undefined,
  onDismissWarning: () => undefined,
  onAffectedContactsOpenChange: () => undefined,
  onTestSendOpenChange: () => undefined,
  onTestRecipientEmailChange: () => undefined,
  onSendTest: () => undefined,
};

describe("PreviewStep", () => {
  it("renders sample preview controls and content", () => {
    const markup = renderToStaticMarkup(<PreviewStep {...baseProps} />);

    expect(markup).toContain("Email preview");
    expect(markup).toContain("Sample - SW");
    expect(markup).toContain("sam@example.org");
    expect(markup).toContain("Hi Sam");
  });

  it("renders sample picker navigation buttons", () => {
    const markup = renderToStaticMarkup(<PreviewStep {...baseProps} />);

    expect(markup).toContain('aria-label="Previous sample contact"');
    expect(markup).toContain('aria-label="Next sample contact"');
    expect(markup).toContain("Continue to review");
  });

  it("renders the inline send-test controls when expanded", () => {
    const markup = renderToStaticMarkup(
      <PreviewStep {...baseProps} testSendOpen={true} />,
    );

    expect(markup).toContain("Send a test to:");
    expect(markup).toContain("nico@adventurescientists.org");
    expect(markup).toContain("Cancel");
  });
});
