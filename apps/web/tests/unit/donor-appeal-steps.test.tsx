import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

vi.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: React.ComponentProps<"button">) => <button {...props}>{children}</button> }));
vi.mock("@/components/ui/input", () => ({ Input: (props: React.ComponentProps<"input">) => <input {...props} /> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("@/app/broadcasts/actions", () => ({ cancelResendAction: vi.fn() }));

import { DonorAudienceStep } from "../../app/donors/_components/donor-audience-step";
import { DonorExcludeStep } from "../../app/donors/_components/donor-exclude-step";
import { DonorResendStep } from "../../app/donors/_components/donor-resend-step";
import { DonorResendPanel } from "../../app/donors/_components/donor-resend-panel";

const lists = [{ id: "campaign:1", name: "2026 Giving Tuesday", type: "Email", status: "Active", memberCount: 99 }];

describe("donor appeal audience and exclusions", () => {
  it("offers both audience choices and Salesforce campaign details", () => {
    const markup = renderToStaticMarkup(<DonorAudienceStep mode="salesforce_lists" selectedListIds={["campaign:1"]} lists={lists} lastSyncedAt="2026-10-14T12:00:00.000Z" refreshing={false} onModeChange={() => undefined} onSelectedListIdsChange={() => undefined} onRefresh={() => undefined} />);
    expect(markup).toContain("Everyone on the newsletter");
    expect(markup).toContain("Salesforce campaigns");
    expect(markup).toContain("2026 Giving Tuesday");
    expect(markup).toContain("99 members");
  });

  it("shows the Insiders default and preview reason counts", () => {
    const markup = renderToStaticMarkup(<DonorExcludeStep excludeInsiders selectedListIds={[]} previousRun={null} earlierAppeals={[]} lists={lists} csvSummary={{ acceptedCount: 4, invalidSkippedCount: 1 }} preview={{ total: 92, consentExcluded: 3, excludedByReason: { insiders: 4 } }} onExcludeInsidersChange={() => undefined} onSelectedListIdsChange={() => undefined} onPreviousRunChange={() => undefined} onCsvChange={() => undefined} onClearCsv={() => undefined} />);
    expect(markup).toContain("Don&#x27;t send to Insiders");
    expect(markup).toContain("92 people will receive this");
    expect(markup).toContain("4 skipped: insiders");
    expect(markup).toContain("3 removed because they unsubscribed or bounced");
  });
});

describe("donor appeal resend", () => {
  it("requires a new subject when resend is enabled", () => {
    const invalid = renderToStaticMarkup(<DonorResendStep enabled days={3} subject="" preheader="" onEnabledChange={() => undefined} onDaysChange={() => undefined} onSubjectChange={() => undefined} onPreheaderChange={() => undefined} />);
    const valid = renderToStaticMarkup(<DonorResendStep enabled days={3} subject="Reminder" preheader="" onEnabledChange={() => undefined} onDaysChange={() => undefined} onSubjectChange={() => undefined} onPreheaderChange={() => undefined} />);
    expect(invalid).toContain('aria-invalid="true"');
    expect(valid).toContain('aria-invalid="false"');
    expect(valid).toContain("haven&#x27;t opened or clicked after 3 days");
  });

  it("renders configured, cancelled, and sent reminder states", () => {
    const configured = renderToStaticMarkup(<DonorResendPanel parentRunId="parent" child={{ id: "child", state: "draft", scheduledAt: null, audienceSize: null }} />);
    const cancelled = renderToStaticMarkup(<DonorResendPanel parentRunId="parent" child={{ id: "child", state: "cancelled", scheduledAt: null, audienceSize: null }} />);
    const sent = renderToStaticMarkup(<DonorResendPanel parentRunId="parent" child={{ id: "child", state: "complete", scheduledAt: "2026-10-15T12:00:00.000Z", audienceSize: 42 }} />);
    expect(configured).toContain("Configured");
    expect(configured).toContain("Cancel reminder");
    expect(cancelled).toContain("Cancelled");
    expect(sent).toContain("Sent");
    expect(sent).toContain("42 recipients");
  });
});
