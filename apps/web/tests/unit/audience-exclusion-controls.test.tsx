import { createRequire } from "node:module";

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("@/components/ui/input", () => ({ Input: (props: React.ComponentProps<"input">) => <input {...props} /> }));
vi.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: React.ComponentProps<"button">) => <button {...props}>{children}</button> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("@/app/broadcasts/actions", () => ({ cancelResendAction: vi.fn() }));

import {
  AudienceExclusionSummary,
  ExclusionCsvUpload,
  PreviousBroadcastExclusion,
} from "../../app/_components/audience-exclusions/audience-exclusion-controls";
import { ResendPanel } from "../../app/_components/audience-exclusions/resend-panel";

const workerRequire = createRequire(import.meta.url);
const { JSDOM } = workerRequire("jsdom") as { readonly JSDOM: new (html?: string, options?: { readonly url?: string }) => { readonly window: Window & typeof globalThis } };

let root: Root | null = null;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
});

describe("volunteer broadcast exclusions", () => {
  it("shows uploaded exclusion counts", () => {
    const html = renderToStaticMarkup(
      <ExclusionCsvUpload
        id="volunteer-exclusions"
        summary={{ acceptedCount: 4, invalidSkippedCount: 1 }}
        onChange={() => undefined}
        onClear={() => undefined}
      />,
    );

    expect(html).toContain("Upload a list of emails to skip");
    expect(html).toContain("4 accepted · 1 invalid");
    expect(html).toContain("Clear uploaded list");
  });

  it("writes the chosen prior broadcast and audience criterion", () => {
    const writes: ({ readonly runId: string; readonly audience: "recipients" | "openers" | "clickers" } | null)[] = [];
    function Example() {
      const [value, setValue] = useState<{ readonly runId: string; readonly audience: "recipients" | "openers" | "clickers" } | null>(null);
      return <PreviousBroadcastExclusion id="earlier" previousRun={value} earlierBroadcasts={[{ id: "run-1", name: "Volunteer update" }]} onChange={(next) => { writes.push(next); setValue(next); }} />;
    }
    act(() => { root?.render(<Example />); });
    const select = document.querySelector<HTMLSelectElement>("#earlier");
    if (select === null) throw new Error("Expected prior-broadcast picker");
    act(() => { select.value = "run-1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(writes).toEqual([{ runId: "run-1", audience: "recipients" }]);
    const openers = [...document.querySelectorAll("button")].find((button) => button.textContent === "Openers");
    if (openers === undefined) throw new Error("Expected openers button");
    act(() => { openers.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(writes.at(-1)).toEqual({ runId: "run-1", audience: "openers" });
  });

  it("renders the composed audience and consent removals", () => {
    const html = renderToStaticMarkup(<AudienceExclusionSummary preview={{ total: 14, excludedByReason: { uploaded_exclusions: 2 }, consentExcluded: 3 }} describeReason={(reason) => reason === "uploaded_exclusions" ? "On your uploaded list" : reason} />);
    expect(html).toContain("14 people will receive this");
    expect(html).toContain("2 skipped · On your uploaded list");
    expect(html).toContain("3 removed because they unsubscribed or bounced");
  });
});

describe("volunteer broadcast resend panel", () => {
  it("renders configured, cancelled, and sent states with volunteer detail links", () => {
    const panel = (child: React.ComponentProps<typeof ResendPanel>["child"]) =>
      renderToStaticMarkup(
        <ResendPanel
          parentRunId="parent"
          child={child}
          workspace="volunteers"
          detailHref={(runId) => `/broadcasts/${runId}`}
        />,
      );

    const configured = panel({
      id: "child",
      state: "draft",
      scheduledAt: null,
      audienceSize: null,
    });
    const cancelled = panel({
      id: "child",
      state: "cancelled",
      scheduledAt: null,
      audienceSize: null,
    });
    const sent = panel({
      id: "child",
      state: "complete",
      scheduledAt: "2026-10-15T12:00:00.000Z",
      audienceSize: 42,
    });

    expect(configured).toContain("Configured");
    expect(configured).toContain("/broadcasts/child");
    expect(configured).toContain("Cancel reminder");
    expect(cancelled).toContain("Cancelled");
    expect(sent).toContain("Sent");
    expect(sent).toContain("42 recipients");
  });
});
