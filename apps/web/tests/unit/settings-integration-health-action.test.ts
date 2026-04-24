import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveAdminSession = vi.hoisted(() => vi.fn());
const refreshIntegrationHealthRecord = vi.hoisted(() => vi.fn());
const revalidateIntegrationHealth = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/api", () => ({
  resolveAdminSession
}));

vi.mock("@/src/server/settings/integration-health", () => ({
  refreshIntegrationHealthRecord,
  isMissingIntegrationHealthTableError: () => false
}));

vi.mock("@/src/server/settings/revalidate", () => ({
  revalidateIntegrationHealth
}));

import { refreshIntegrationHealthAction } from "../../app/settings/actions";
import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime
} from "../../src/server/stage1-runtime.test-support";

describe("refreshIntegrationHealthAction", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    resolveAdminSession.mockReset();
    refreshIntegrationHealthRecord.mockReset();
    revalidateIntegrationHealth.mockReset();
    resolveAdminSession.mockResolvedValue({
      ok: true,
      user: {
        id: "user:admin"
      }
    });
    runtime = await createStage1WebTestRuntime();
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("returns a 403-shaped result for non-admin users", async () => {
    resolveAdminSession.mockResolvedValueOnce({
      ok: false,
      code: "forbidden"
    });

    const result = await refreshIntegrationHealthAction("gmail");

    expect(result).toMatchObject({
      ok: false,
      code: "forbidden",
      message: "Only admins can refresh integration health."
    });
    expect(refreshIntegrationHealthRecord).not.toHaveBeenCalled();
    expect(revalidateIntegrationHealth).not.toHaveBeenCalled();
  });

  it("audits and revalidates on a successful refresh", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    refreshIntegrationHealthRecord.mockResolvedValue({
      id: "gmail",
      serviceName: "gmail",
      category: "messaging",
      status: "healthy",
      lastCheckedAt: "2026-04-20T18:00:00.000Z",
      degradedSinceAt: null,
      lastAlertSentAt: null,
      detail: "Healthy",
      metadataJson: {},
      createdAt: "2026-04-20T18:00:00.000Z",
      updatedAt: "2026-04-20T18:00:00.000Z"
    });

    const result = await refreshIntegrationHealthAction("gmail");
    const audits = await runtime.context.repositories.auditEvidence.listByEntity({
      entityType: "integration",
      entityId: "gmail"
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        serviceName: "gmail",
        status: "healthy"
      }
    });
    expect(audits.at(-1)).toMatchObject({
      actorType: "user",
      actorId: "user:admin",
      action: "settings.integration.refreshed",
      entityType: "integration",
      entityId: "gmail",
      policyCode: "settings.admin_mutation"
    });
    expect(revalidateIntegrationHealth).toHaveBeenCalledTimes(1);
  });
});
