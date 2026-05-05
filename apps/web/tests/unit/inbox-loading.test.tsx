import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { readonly className?: string }) =>
    createElement("div", { className, "data-skeleton": true }),
}));

vi.mock("@/app/_lib/design-tokens", () => ({
  SPACING: { container: "px-6 py-4" },
  TONE: {},
}));

vi.mock("@/app/_lib/design-tokens-v2", () => ({
  LAYOUT: {
    iconRailWidth: "w-16",
    listWidth: "w-80",
    headerHeight: "h-14",
    welcomeHeaderHeight: "h-16",
  },
}));

import { TimelineSkeleton } from "../../app/inbox/_components/inbox-loading";

describe("TimelineSkeleton", () => {
  it("keeps skeleton bubbles capped at the shared 560px width without a full-width wrapper", () => {
    const markup = renderToStaticMarkup(createElement(TimelineSkeleton));

    expect(markup).toContain("col-start-2 justify-self-start max-w-[560px]");
    expect(markup).toContain("col-start-2 justify-self-end max-w-[560px]");
    expect(markup).toContain(
      "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm",
    );
    expect(markup).not.toContain("justify-self-start w-full max-w-[560px]");
    expect(markup).not.toContain("justify-self-end w-full max-w-[560px]");
  });

  it("keeps the lifecycle pill skeleton inline-sized", () => {
    const markup = renderToStaticMarkup(createElement(TimelineSkeleton));

    expect(markup).toContain("col-start-2 flex py-1");
    expect(markup).toContain(
      "inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2",
    );
    expect(markup).not.toContain("col-start-2 flex w-full");
  });
});
