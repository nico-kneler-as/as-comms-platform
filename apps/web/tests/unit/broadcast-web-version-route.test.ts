import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CreateDraftInput } from "@as-comms/contracts";

import { GET } from "../../app/b/[token]/route";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function buildRun(id: string): CreateDraftInput {
  return {
    id,
    kind: "newsletter",
    launchType: "normal_email",
    projectId: null,
    name: null,
    fromEmail: "newsletter@example.org",
    fromName: null,
    replyToEmail: null,
    subjectTemplate: "Subject",
    subjectTemplateB: null,
    abTestEnabled: false,
    bodyHtmlTemplate: "<p>Hello</p>",
    bodyDesignJson: null,
    bodyTextTemplate: "Hello",
    preheader: null,
    audienceCriteria: {
      projectId: null,
      projectIds: [],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: null,
    createdByUserId: null,
    lastEditedByUserId: null,
  };
}

async function request(token: string): Promise<Response> {
  return GET(new Request("https://app.example.test/b/ignored"), {
    params: Promise.resolve({ token }),
  });
}

describe("broadcast web-version route", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    runtime = await createStage1WebTestRuntime();
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("serves a rendered published snapshot with cacheable HTML headers", async () => {
    if (runtime === null) throw new Error("Expected test runtime.");
    await runtime.runtime.campaigns.campaignRuns.create(buildRun("route-run"));
    const version = await runtime.runtime.campaigns.broadcastWebVersions.ensure(
      "route-run",
    );
    await runtime.runtime.campaigns.broadcastWebVersions.storeRendered("route-run", {
      html: "<html><body>snapshot</body></html>",
      title: "Snapshot",
    });

    const response = await request(version.publicToken);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.text()).resolves.toContain("snapshot");
  });

  it("uses the same neutral no-store page for unknown and unavailable tokens", async () => {
    if (runtime === null) throw new Error("Expected test runtime.");
    await runtime.runtime.campaigns.campaignRuns.create(buildRun("route-pending"));
    const pending = await runtime.runtime.campaigns.broadcastWebVersions.ensure(
      "route-pending",
    );
    const lookup = vi.spyOn(
      runtime.runtime.campaigns.broadcastWebVersions,
      "findPublishedByToken",
    );

    for (const token of ["unknown", pending.publicToken]) {
      const response = await request(token);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.text()).resolves.toContain(
        "This email isn't available",
      );
    }
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
