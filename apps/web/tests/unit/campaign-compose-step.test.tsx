import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  Braces: () => null,
  Info: () => null,
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

import { ComposeStep } from "../../app/broadcasts/new/_components/compose-step";

const baseProps: React.ComponentProps<typeof ComposeStep> = {
  subject: "",
  preheader: "",
  bodyPlaintext: "",
  autosaveLabel: "Saved 12s ago",
  frozen: false,
  onSubjectChange: () => undefined,
  onPreheaderChange: () => undefined,
  onBodyChange: () => undefined,
  onBack: () => undefined,
  onContinue: () => undefined,
};

describe("ComposeStep snapshots", () => {
  it("renders the compact compose state without inline preview", () => {
    const markup = renderToStaticMarkup(<ComposeStep {...baseProps} />);

    expect(markup).toMatchSnapshot();
    expect(markup).toContain("Write your email");
    expect(markup).not.toContain("Live Preview");
    expect(markup).not.toContain("Next sample contact");
  });

  it("renders populated subject and body controls", () => {
    expect(
      renderToStaticMarkup(
        <ComposeStep
          {...baseProps}
          subject="Gear pickup for {{firstName}}"
          preheader="Everything you need for tomorrow."
          bodyPlaintext={
            "Hi {{firstName}},\n\nSee you at the warehouse.\n\nBest,\nAS"
          }
        />,
      ),
    ).toMatchSnapshot();
  });
});
