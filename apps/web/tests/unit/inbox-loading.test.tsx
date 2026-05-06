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

import {
  InboxDetailLoading,
  QueueRowSkeleton,
  TimelineSkeleton,
} from "../../app/inbox/_components/inbox-loading";

describe("TimelineSkeleton", () => {
  it("keeps skeleton bubbles capped at the shared 560px width using stable full-width geometry", () => {
    const markup = renderToStaticMarkup(createElement(TimelineSkeleton));

    expect(markup).toContain(
      "col-start-2 justify-self-start w-full max-w-[560px]",
    );
    expect(markup).toContain(
      "col-start-2 min-w-0 justify-self-end w-full max-w-[560px]",
    );
    expect(markup).toContain(
      "w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm",
    );
    expect(markup).toContain(
      "w-full rounded-2xl border px-4 py-3 shadow-sm rounded-br-md border-sky-200 bg-sky-50",
    );
    expect(markup).not.toContain("border-sky-600 bg-sky-600");
  });

  it("keeps the lifecycle pill skeleton inline-sized", () => {
    const markup = renderToStaticMarkup(createElement(TimelineSkeleton));

    expect(markup).toContain("col-start-2 flex py-1");
    expect(markup).toContain(
      "inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm",
    );
    expect(markup).not.toContain("col-start-2 flex w-full");
  });

  it("renders queue rows with avatar, channel, snippet, and badge-shaped placeholders", () => {
    const markup = renderToStaticMarkup(createElement(QueueRowSkeleton));

    expect(markup).toContain("flex min-h-[88px] gap-3 border-b");
    expect(markup).toContain("size-9 shrink-0 rounded-full");
    expect(markup).toContain("size-3 shrink-0 rounded-sm");
    expect(markup).toContain("h-5 w-20 rounded");
  });

  it("keeps detail loading shaped like the real header, timeline, and composer bar", () => {
    const markup = renderToStaticMarkup(createElement(InboxDetailLoading));

    expect(markup).toContain('aria-label="Loading conversation history"');
    expect(markup).toContain("items-center justify-between gap-4 border-b");
    expect(markup).toContain("min-h-0 flex-1 overflow-y-auto bg-slate-50/40");
    expect(markup).toContain("shrink-0 border-t border-slate-200 bg-white");
  });
});
