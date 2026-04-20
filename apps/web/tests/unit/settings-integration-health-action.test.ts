import { describe, expect, it, vi } from "vitest";

const requireAdmin = vi.hoisted(() => vi.fn());
const refreshIntegrationHealthRecord = vi.hoisted(() => vi.fn());
const revalidateIntegrationHealth = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/session", () => ({
  requireAdmin
}));

vi.mock("@/src/server/settings/integration-health", () => ({
  refreshIntegrationHealthRecord,
  isMissingIntegrationHealthTableError: () => false
}));

vi.mock("@/src/server/settings/revalidate", () => ({
  revalidateIntegrationHealth
}));

import { refreshIntegrationHealthAction } from "../../app/settings/actions";

describe("refreshIntegrationHealthAction", () => {
  it("returns a 403-shaped result for non-admin users", async () => {
    requireAdmin.mockRejectedValue(new Error("FORBIDDEN"));

    const formData = new FormData();
    formData.set("service", "gmail");
    const result = await refreshIntegrationHealthAction(formData);

    expect(result).toMatchObject({
      ok: false,
      code: "forbidden",
      message: "Only admins can refresh integration health."
    });
    expect(refreshIntegrationHealthRecord).not.toHaveBeenCalled();
    expect(revalidateIntegrationHealth).not.toHaveBeenCalled();
  });
});
