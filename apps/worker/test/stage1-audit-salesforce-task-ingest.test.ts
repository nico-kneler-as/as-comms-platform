import { describe, expect, it } from "vitest";

import {
  buildSalesforceTaskAuditReport,
  deriveSalesforceTaskAuditSignals,
  inferSalesforceTaskShape,
  type SalesforceTaskAuditRow
} from "../src/ops/_salesforce-task-audit.js";

function buildRow(
  overrides: Partial<SalesforceTaskAuditRow>
): SalesforceTaskAuditRow {
  return {
    canonicalEventId: overrides.canonicalEventId ?? "evt:1",
    sourceEvidenceId: overrides.sourceEvidenceId ?? "sev:1",
    providerRecordId: overrides.providerRecordId ?? "task:1",
    payloadRef: overrides.payloadRef ?? "salesforce://Task/task:1",
    contactId: overrides.contactId ?? "contact:1",
    displayName: overrides.displayName ?? "Sample Contact",
    salesforceContactId: overrides.salesforceContactId ?? "003-sample",
    membershipCount: overrides.membershipCount ?? 1,
    projects: overrides.projects ?? "Sample Project",
    messageKind: overrides.messageKind ?? "auto",
    subject: overrides.subject ?? "Subject",
    snippet: overrides.snippet ?? "Snippet",
    sourceLabel: overrides.sourceLabel ?? "Salesforce Flow",
    occurredAt: overrides.occurredAt ?? "2026-04-22T00:00:00.000Z",
    subjectEventCount: overrides.subjectEventCount ?? 1,
    subjectContactCount: overrides.subjectContactCount ?? 1
  };
}

describe("salesforce task audit helpers", () => {
  it("detects human-conversation signals from reply-like snippets", () => {
    const signals = deriveSalesforceTaskAuditSignals(
      buildRow({
        subject: "Re: Update on Hex 43191",
        snippet:
          "From: teammate@adventurescientists.org\nRecipients: volunteer@example.org\nSubject: Re: Update on Hex 43191\nBody:\nHi there!\n\nOn Mon, Apr 20, 2026 at 1:00 PM Volunteer wrote:"
      })
    );

    expect(signals).toMatchObject({
      subjectPrefix: "reply",
      hasStructuredEnvelope: true,
      hasQuotedReply: true,
      hasConversationSignal: true
    });
    expect(inferSalesforceTaskShape(signals)).toBe(
      "probable_human_conversation"
    );
  });

  it("detects probable automation from repeated training templates", () => {
    const signals = deriveSalesforceTaskAuditSignals(
      buildRow({
        subject: "Last Call: PNW Training",
        snippet: "<p>Hi volunteer, start your training today.</p>",
        subjectContactCount: 117
      })
    );

    expect(signals).toMatchObject({
      hasHtmlMarkup: true,
      hasVolunteerAutomationKeyword: true,
      hasBatchLikeSubject: true,
      hasAutomationSignal: true
    });
    expect(inferSalesforceTaskShape(signals)).toBe("probable_automation");
  });

  it("summarizes mismatch buckets for current labels vs inferred shape", () => {
    const report = buildSalesforceTaskAuditReport(
      [
        buildRow({
          messageKind: "auto",
          subject: "Re: Hex 21178 delay",
          snippet:
            "From: pnwbio@adventurescientists.org\nRecipients: planetrelations@gmail.com\nSubject: Re: Hex 21178 delay\nBody:\nOn Sat, Apr 18, 2026 at 10:36 PM Jeff wrote:"
        }),
        buildRow({
          canonicalEventId: "evt:2",
          sourceEvidenceId: "sev:2",
          providerRecordId: "task:2",
          contactId: "contact:2",
          messageKind: "one_to_one",
          subject: "Gracias por Aplicar - Siguiente paso: Capacitacion en Linea",
          snippet: "<p>Hola! Gracias por aplicar. Start your training today.</p>",
          subjectEventCount: 40,
          subjectContactCount: 40
        }),
        buildRow({
          canonicalEventId: "evt:3",
          sourceEvidenceId: "sev:3",
          providerRecordId: "task:3",
          contactId: "contact:3",
          subject: "Last Call: PNW Training",
          snippet: "<p>Start your training today.</p>",
          subjectEventCount: 117,
          subjectContactCount: 117
        })
      ],
      {
        sampleLimit: 2,
        topSubjectLimit: 5
      }
    );

    expect(report.totalRows).toBe(3);
    expect(report.distinctContacts).toBe(3);
    expect(report.signalCounts).toEqual({
      automation_signal: 2,
      conversation_signal: 1
    });
    expect(report.mismatchCounts).toEqual({
      auto_with_conversation_signal: 1,
      auto_but_probably_human: 1,
      one_to_one_but_probably_automation: 1,
      one_to_one_with_automation_signal: 1
    });
    expect(report.samples.autoWithConversationSignal).toHaveLength(1);
    expect(report.samples.autoButProbablyHuman).toHaveLength(1);
    expect(report.samples.oneToOneButProbablyAutomation).toHaveLength(1);
  });
});
