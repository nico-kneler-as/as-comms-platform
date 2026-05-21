import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  CheckCircle2: () => null,
  Filter: () => null,
  LoaderCircle: () => null,
  Search: () => null,
  Sparkles: () => null,
  User: () => null,
  Users: () => null,
  X: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: {
    readonly children: React.ReactNode;
  }) => <button {...props}>{children}</button>,
}));

import { AudienceCountPanel } from "../../app/broadcasts/new/_components/audience-builder-step";

describe("AudienceCountPanel snapshots", () => {
  it("renders the neutral empty state", () => {
    expect(
      renderToStaticMarkup(
        <AudienceCountPanel
          countState={{ count: 0, hasAppliedFilters: false }}
          loading={false}
        />,
      ),
    ).toMatchInlineSnapshot(`"<div aria-live="polite" class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"><div class="flex items-baseline gap-3"><span class="text-[28px] font-semibold leading-none tabular-nums text-slate-900">—</span><span class="text-[12px] text-slate-500">Pick an audience mode to start.</span></div></div>"`);
  });

  it("renders the positive matched state", () => {
    expect(
      renderToStaticMarkup(
        <AudienceCountPanel
          countState={{ count: 184, hasAppliedFilters: true }}
          loading={false}
        />,
      ),
    ).toMatchInlineSnapshot(`"<div aria-live="polite" class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"><div class="flex items-baseline gap-3"><span class="text-[28px] font-semibold leading-none tabular-nums text-slate-900">184</span><span class="text-[12px] text-slate-500">recipients match</span></div></div>"`);
  });

  it("renders the large-send warning state", () => {
    expect(
      renderToStaticMarkup(
        <AudienceCountPanel
          countState={{ count: 5400, hasAppliedFilters: true }}
          loading={false}
        />,
      ),
    ).toMatchInlineSnapshot(`"<div aria-live="polite" class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"><div class="flex items-baseline gap-3"><span class="text-[28px] font-semibold leading-none tabular-nums text-slate-900">5,400</span><span class="text-[12px] text-slate-500">recipients match</span></div><div class="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-white px-3 py-2 text-[12px] text-amber-800"><span>This is a large send. Double-check the filters before continuing.</span></div></div>"`);
  });
});
