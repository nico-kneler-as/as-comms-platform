import { describe, expect, it } from "vitest";

import { automatedEmailTemplates } from "@as-comms/db";
import { createTestStage1Context } from "@as-comms/db/test-helpers";
import { renderAutomatedEmail } from "@as-comms/domain";

import {
  convertSalesforceHtmlToTipTap,
  convertSalesforceSubject,
} from "../import-sf-flow-email-converter.js";
import {
  FLOW_PROJECTS,
  guessAutomatedEmailKind,
  humanizeFlowActionLabel,
  routeFlowEmail,
  runFlowEmailImport,
} from "../import-sf-flow-emails.js";

const fixtureFlow = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <label>PNW Biodiversity Lifecycle</label>
  <status>Active</status>
  <textTemplates><name>subject_copy</name><text>Welcome {!Contact__r.FirstName}</text></textTemplates>
  <textTemplates><name>body_copy</name><text><![CDATA[<h2>Hello {!Contact__r.FirstName}</h2><p>Volunteer {!Contact__r.Volunteer_ID_Plain__c}</p>]]></text></textTemplates>
  <actionCalls>
    <label>Send Application Received Email</label>
    <actionType>emailSimple</actionType>
    <inputParameters><name>emailSubject</name><value><elementReference>subject_copy</elementReference></value></inputParameters>
    <inputParameters><name>emailBody</name><value><elementReference>body_copy</elementReference></value></inputParameters>
  </actionCalls>
</Flow>`;

function assertOnlyRendererNodes(node: unknown): void {
  const record = node as {
    readonly type?: string;
    readonly content?: unknown[];
  };
  expect([
    "doc",
    "paragraph",
    "text",
    "bulletList",
    "orderedList",
    "listItem",
    "hardBreak",
    "blockquote",
    "mergeField",
  ]).toContain(record.type);
  for (const child of record.content ?? []) assertOnlyRendererNodes(child);
}

describe("Salesforce flow email conversion", () => {
  it("unwraps styles, flattens headings, preserves nested lists, and safely renders", () => {
    const converted = convertSalesforceHtmlToTipTap(
      '<div><h2>Welcome &amp; hello</h2><p><span><strong>Bold</strong> <u>plain</u></span><br><a href="https://example.org">safe</a> <a href="javascript:alert(1)">unsafe</a></p><ul><li>One<ul><li>Nested</li></ul></li></ul><img src="x"></div>',
    );

    expect(converted.flattenedHeadings).toBe(1);
    expect(converted.droppedImages).toBe(1);
    expect(converted.doc).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Welcome & hello",
              marks: [{ type: "bold" }],
            },
          ],
        },
        { type: "paragraph" },
        { type: "bulletList" },
      ],
    });
    assertOnlyRendererNodes(converted.doc);
    expect(() =>
      renderAutomatedEmail({
        subjectTemplate: "Subject",
        bodyDoc: converted.doc,
        values: {},
        frame: { projectName: "PNW", reasonLine: "Reason" },
      }),
    ).not.toThrow();
  });

  it("converts mapped placeholders into inline pills and exposes unmapped Salesforce paths", () => {
    const converted = convertSalesforceHtmlToTipTap(
      "<p>Hi {!Contact__r.FirstName} {!Esri_Username__c} {!Unknown__c}&nbsp;done</p>",
    );
    const subject = convertSalesforceSubject(
      "Hi {!Contact__r.Email} {!Nope__c}",
    );

    expect(converted.doc).toMatchObject({
      content: [
        {
          content: [
            { type: "text", text: "Hi " },
            { type: "mergeField", attrs: { key: "firstName" } },
            { type: "text", text: " " },
            { type: "mergeField", attrs: { key: "esriUsername" } },
            { type: "text", text: " [SF: Unknown__c] done" },
          ],
        },
      ],
    });
    expect(converted.unmappedPlaceholders).toEqual(["Unknown__c"]);
    expect(subject).toEqual({
      subject: "Hi {{email}} [SF: Nope__c]",
      unmappedPlaceholders: ["Nope__c"],
    });
    expect(() =>
      renderAutomatedEmail({
        subjectTemplate: "Hi {{email}}",
        bodyDoc: converted.doc,
        values: {
          firstName: "Casey",
          esriUsername: "casey",
          email: "casey@example.org",
        },
        frame: { projectName: "PNW", reasonLine: "Reason" },
      }),
    ).not.toThrow();
  });

  it("routes B&B actions and guesses names and kinds deterministically", () => {
    expect(routeFlowEmail("PNW Bio lifecycle", "Anything")).toEqual({
      projectId: FLOW_PROJECTS.pnw.id,
      projectName: FLOW_PROJECTS.pnw.name,
    });
    expect(routeFlowEmail("Orcas lifecycle", "Anything")).toEqual({
      projectId: FLOW_PROJECTS.orcas.id,
      projectName: FLOW_PROJECTS.orcas.name,
    });
    expect(routeFlowEmail("TWBP lifecycle", "Anything")).toEqual({
      projectId: FLOW_PROJECTS.twbp.id,
      projectName: FLOW_PROJECTS.twbp.name,
    });
    expect(routeFlowEmail("B&B lifecycle", "Beech accepted email")).toEqual({
      projectId: FLOW_PROJECTS.beech.id,
      projectName: FLOW_PROJECTS.beech.name,
    });
    expect(
      routeFlowEmail("Beech & Butternut", "Butternut accepted email"),
    ).toEqual({
      projectId: FLOW_PROJECTS.butternut.id,
      projectName: FLOW_PROJECTS.butternut.name,
    });
    expect(routeFlowEmail("B&B lifecycle", "Combined welcome email")).toEqual({
      projectId: FLOW_PROJECTS.butternut.id,
      projectName: FLOW_PROJECTS.butternut.name,
    });
    expect(humanizeFlowActionLabel("Send Training Reminder 1 Email")).toBe(
      "Training reminder #1",
    );
    expect(guessAutomatedEmailKind("Send Application Reminder Email")).toBe(
      "application_nudge",
    );
    expect(guessAutomatedEmailKind("Send Accepted Email")).toBe("accepted");
  });

  it("dry-runs without writes, creates drafts on apply, and skips a second apply", async () => {
    const context = await createTestStage1Context();
    try {
      await context.repositories.projectDimensions.upsert({
        projectId: FLOW_PROJECTS.pnw.id,
        projectName: FLOW_PROJECTS.pnw.name,
        source: "salesforce",
      });
      const options = {
        flows: [{ path: "PNW.flow-meta.xml", xml: fixtureFlow }],
      } as const;

      const dryRun = await runFlowEmailImport({}, { ...options, apply: false });
      expect(dryRun.templates).toMatchObject([{ status: "would_create" }]);
      await expect(
        context.db.select().from(automatedEmailTemplates),
      ).resolves.toHaveLength(0);

      const applied = await runFlowEmailImport(
        { db: context.db },
        { ...options, apply: true },
      );
      expect(applied.templates).toMatchObject([
        {
          status: "created",
          name: "Application received",
          kind: "application_received",
          mappedFields: ["firstName", "volunteerId"],
          subjectResourceName: "subject_copy",
          bodyResourceName: "body_copy",
        },
      ]);
      const templates = await context.db.select().from(automatedEmailTemplates);
      expect(templates).toHaveLength(1);
      expect(templates[0]).toMatchObject({
        isActive: false,
        publishedAt: null,
        publishedSubject: null,
        publishedDoc: null,
      });

      const second = await runFlowEmailImport(
        { db: context.db },
        { ...options, apply: true },
      );
      expect(second.templates).toMatchObject([{ status: "skipped_existing" }]);
      await expect(
        context.db.select().from(automatedEmailTemplates),
      ).resolves.toHaveLength(1);

      await expect(
        runFlowEmailImport(
          { db: context.db },
          {
            flows: [{ path: "PNW.flow-meta.xml", xml: fixtureFlow }],
            apply: true,
            projectId: FLOW_PROJECTS.pnw.id,
          },
        ),
      ).resolves.toMatchObject({
        templates: [{ status: "skipped_existing" }],
      });
    } finally {
      await context.dispose();
    }
  });

  it("aborts apply before writing when a routed platform project is absent", async () => {
    const context = await createTestStage1Context();
    try {
      await expect(
        runFlowEmailImport(
          { db: context.db },
          {
            flows: [{ path: "PNW.flow-meta.xml", xml: fixtureFlow }],
            apply: true,
          },
        ),
      ).rejects.toThrow(
        `platform project_id not found: ${FLOW_PROJECTS.pnw.id}`,
      );
      await expect(
        context.db.select().from(automatedEmailTemplates),
      ).resolves.toHaveLength(0);
    } finally {
      await context.dispose();
    }
  });
});
