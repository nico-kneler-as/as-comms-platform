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

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { readonly children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({
    children,
  }: {
    readonly children: React.ReactNode;
  }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    readonly children: React.ReactNode;
    readonly onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({
    children,
  }: {
    readonly children: React.ReactNode;
  }) => <>{children}</>,
}));

vi.mock("@/app/inbox/_components/composer-toolbar", () => ({
  ComposerToolbar: () => <div data-toolbar="true" />,
}));

vi.mock("@/app/inbox/_components/composer-editor-surface", () => ({
  RichTextComposerEditor: ({
    bodyPlaintext,
    toolbarFooter,
  }: {
    readonly bodyPlaintext: string;
    readonly toolbarFooter?: (input: {
      readonly activeCommands: ReadonlySet<string>;
      readonly onCommand: (command: string) => void;
      readonly insertText: (value: string) => void;
    }) => React.ReactNode;
  }) => (
    <div>
      <div data-editor="true">{bodyPlaintext}</div>
      {toolbarFooter
        ? toolbarFooter({
            activeCommands: new Set<string>(),
            onCommand: () => undefined,
            insertText: () => undefined,
          })
        : null}
    </div>
  ),
}));

import { ComposeStep } from "../../app/campaigns/new/_components/compose-step";

const baseProps: React.ComponentProps<typeof ComposeStep> = {
  subject: "",
  preheader: "",
  bodyPlaintext: "",
  autosaveLabel: "Saved 12s ago",
  previewData: null,
  previewLoading: false,
  warningDismissed: false,
  affectedContactsOpen: false,
  testSendOpen: false,
  testRecipientEmail: "nico@adventurescientists.org",
  testSendPending: false,
  frozen: false,
  onSubjectChange: () => undefined,
  onPreheaderChange: () => undefined,
  onBodyChange: () => undefined,
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

describe("ComposeStep snapshots", () => {
  it("renders the empty compose state", () => {
    expect(renderToStaticMarkup(<ComposeStep {...baseProps} />)).toMatchSnapshot();
  });

  it("renders the populated merge-token preview state", () => {
    expect(
      renderToStaticMarkup(
        <ComposeStep
          {...baseProps}
          subject="Gear pickup for {{firstName}}"
          preheader="Everything you need for tomorrow."
          bodyPlaintext={"Hi {{firstName}},\n\nSee you at the warehouse.\n\nBest,\nAS"}
          previewData={{
            audienceSize: 24,
            sampleIndex: 0,
            sampleCount: 24,
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
          }}
        />,
      ),
    ).toMatchSnapshot();
  });

  it("renders the validation warning state", () => {
    expect(
      renderToStaticMarkup(
        <ComposeStep
          {...baseProps}
          subject="Hello {{firstName}}"
          bodyPlaintext="Body with {{firstName}}"
          previewData={{
            audienceSize: 8,
            sampleIndex: 0,
            sampleCount: 8,
            warningCount: 2,
            footerAddress: "123 Research Way • Bozeman, MT, 59715 • USA",
            sample: {
              contactId: "contact-2",
              name: "Alex Chen",
              initials: "AC",
              email: "alex@example.org",
              project: "Forests",
              fromEmail: "forests@adventurescientists.org",
              subject: "Hello Alex Chen",
              html: "<p>Hello Alex Chen</p>",
              text: "Hello Alex Chen",
            },
            affectedContacts: [
              {
                contactId: "contact-3",
                name: "Unknown",
                email: "blank@example.org",
                project: "Forests",
                missingTokens: ["firstName"],
              },
            ],
          }}
        />,
      ),
    ).toMatchSnapshot();
  });
});
