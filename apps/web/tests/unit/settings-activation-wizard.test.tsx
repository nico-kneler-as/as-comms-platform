import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StepKnowledge } from "../../app/settings/_components/activation-wizard/step-knowledge";

describe("StepKnowledge", () => {
  it("renders a single save-and-sync action", () => {
    const html = renderToStaticMarkup(
      createElement(StepKnowledge, {
        notionUrl: "https://www.notion.so/workspace/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        knowledgeStatus: "idle",
        knowledgeMessage: null,
        onNotionUrlChange: () => undefined,
        onSync: () => undefined,
      }),
    );

    expect(html).toContain("Save and sync");
    expect(html).toContain("AI knowledge source");
  });

  it("renders the queued success state", () => {
    const html = renderToStaticMarkup(
      createElement(StepKnowledge, {
        notionUrl: "https://www.notion.so/workspace/page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        knowledgeStatus: "done",
        knowledgeMessage: null,
        onNotionUrlChange: () => undefined,
        onSync: () => undefined,
      }),
    );

    expect(html).toContain("Saved. Sync queued.");
  });
});
