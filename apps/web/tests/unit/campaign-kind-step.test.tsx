import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  CheckCircle2: () => null,
  MailOpen: () => null,
  Newspaper: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: {
    readonly children: React.ReactNode;
  }) => <button {...props}>{children}</button>,
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

import { CampaignKindStep } from "../../app/campaigns/new/_components/campaign-kind-step";

function collectText(node: React.ReactNode): string {
  if (
    typeof node === "string" ||
    typeof node === "number" ||
    typeof node === "bigint"
  ) {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(collectText).join("");
  }

  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return collectText(node.props.children);
  }

  return "";
}

function findButtonByText(
  node: React.ReactNode,
  text: string,
): React.ReactElement<{ onClick?: () => void }> | null {
  if (
    React.isValidElement<{ children?: React.ReactNode; onClick?: () => void }>(node)
  ) {
    if (node.type === "button" && collectText(node.props.children).includes(text)) {
      return node;
    }

    const children = React.Children.toArray(node.props.children);
    for (const child of children) {
      const match = findButtonByText(child, text);
      if (match !== null) {
        return match;
      }
    }
  }

  return null;
}

const baseProps: React.ComponentProps<typeof CampaignKindStep> = {
  isAdmin: true,
  value: "project",
  onChange: () => undefined,
  onBack: () => undefined,
  onContinue: () => undefined,
};

describe("CampaignKindStep admin gating", () => {
  it("renders both cards as selectable for admins", () => {
    const onChange = vi.fn();
    const element = (
      <CampaignKindStep {...baseProps} isAdmin={true} onChange={onChange} />
    );
    const markup = renderToStaticMarkup(element);
    const newsletterButton = findButtonByText(
      CampaignKindStep({
        ...baseProps,
        isAdmin: true,
        onChange,
      }),
      "Newsletter",
    );

    expect(markup).toContain("Project email");
    expect(markup).toContain("Newsletter");
    expect(markup).not.toContain("Newsletter sends are admin-only");
    expect(newsletterButton).not.toBeNull();

    newsletterButton?.props.onClick?.();
    expect(onChange).toHaveBeenCalledWith("newsletter");
  });

  it("renders the newsletter card as disabled for non-admins", () => {
    const markup = renderToStaticMarkup(
      <CampaignKindStep {...baseProps} isAdmin={false} />,
    );

    expect(markup).toContain("Newsletter sends are admin-only");
    expect(markup).toContain("cursor-not-allowed opacity-60");
    expect(markup).toContain("aria-disabled=\"true\"");
  });

  it("ignores newsletter clicks for non-admins", () => {
    const onChange = vi.fn();
    const newsletterButton = findButtonByText(
      CampaignKindStep({
        ...baseProps,
        isAdmin: false,
        onChange,
      }),
      "Newsletter",
    );

    expect(newsletterButton).not.toBeNull();
    newsletterButton?.props.onClick?.();
    expect(onChange).not.toHaveBeenCalled();
  });
});
