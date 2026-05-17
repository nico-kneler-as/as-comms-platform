import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  CheckCircle2: () => null,
  Sparkles: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: {
    readonly children: React.ReactNode;
  }) => <button {...props}>{children}</button>,
}));

import { AudienceCountPanel } from "../../app/campaigns/new/_components/audience-builder-step";

describe("AudienceCountPanel snapshots", () => {
  it("renders the neutral empty state", () => {
    expect(
      renderToStaticMarkup(
        <AudienceCountPanel
          countState={{ count: 0, hasAppliedFilters: false }}
          loading={false}
          previewOpen={false}
          onPreviewToggle={() => undefined}
        />,
      ),
    ).toMatchInlineSnapshot(`"<div class="rounded-xl border border-slate-200 bg-slate-50 p-5"><div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div class="min-w-0"><div aria-live="polite" class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-white text-slate-600 ring-1 ring-slate-200">Live audience</div><div class="mt-4 flex items-end gap-3"><span class="text-5xl font-semibold tabular-nums text-slate-900">—</span><span class="pb-1 text-sm text-slate-500">recipients match · live as you change filters</span></div><p class="mt-3 text-sm text-slate-600">Pick filters to start</p></div><button variant="outline">Preview audience</button></div></div>"`);
  });

  it("renders the positive matched state", () => {
    expect(
      renderToStaticMarkup(
        <AudienceCountPanel
          countState={{ count: 184, hasAppliedFilters: true }}
          loading={false}
          previewOpen={true}
          onPreviewToggle={() => undefined}
        />,
      ),
    ).toMatchInlineSnapshot(`"<div class="rounded-xl border border-slate-200 bg-slate-50 p-5"><div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div class="min-w-0"><div aria-live="polite" class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">Live audience</div><div class="mt-4 flex items-end gap-3"><span class="text-5xl font-semibold tabular-nums text-slate-900">184</span><span class="pb-1 text-sm text-slate-500">recipients match · live as you change filters</span></div><p class="mt-3 text-sm text-slate-600">The live audience is ready to inspect.</p></div><button variant="outline">Hide preview</button></div></div>"`);
  });

  it("renders the large-send warning state", () => {
    expect(
      renderToStaticMarkup(
        <AudienceCountPanel
          countState={{ count: 5400, hasAppliedFilters: true }}
          loading={false}
          previewOpen={false}
          onPreviewToggle={() => undefined}
        />,
      ),
    ).toMatchInlineSnapshot(`"<div class="rounded-xl border border-slate-200 bg-slate-50 p-5"><div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div class="min-w-0"><div aria-live="polite" class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">Live audience</div><div class="mt-4 flex items-end gap-3"><span class="text-5xl font-semibold tabular-nums text-slate-900">5,400</span><span class="pb-1 text-sm text-slate-500">recipients match · live as you change filters</span></div><p class="mt-3 text-sm text-slate-600">The live audience is ready to inspect.</p></div><button variant="outline">Preview audience</button></div><div class="mt-4 rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm text-amber-800">This is a large send. Double-check the filters before continuing.</div></div>"`);
  });
});
