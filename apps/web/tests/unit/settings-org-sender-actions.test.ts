import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveAdminSession = vi.hoisted(() => vi.fn());
const revalidateAccessSettings = vi.hoisted(() => vi.fn());
const revalidateIntegrationHealth = vi.hoisted(() => vi.fn());
const revalidateNewsletterSettings = vi.hoisted(() => vi.fn());
const revalidateProjectSettings = vi.hoisted(() => vi.fn());
const revalidateTag = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  revalidateTag
}));

vi.mock("@/src/server/auth/api", () => ({
  resolveAdminSession
}));

vi.mock("@/src/server/settings/revalidate", () => ({
  revalidateAccessSettings,
  revalidateIntegrationHealth,
  revalidateNewsletterSettings,
  revalidateProjectSettings
}));

import {
  createOrgSenderAction,
  setOrgSenderEnabledAction
} from "../../app/settings/actions";
import {
  createOrgSenderForTests,
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime
} from "../../src/server/stage1-runtime.test-support";
import { listAllOrgSenders } from "../../src/server/stage1-runtime";

function adminSession() {
  return {
    ok: true as const,
    user: {
      id: "user:admin"
    }
  };
}

describe("org sender settings actions", () => {
  let runtime: Stage1WebTestRuntime | null = null;

  beforeEach(async () => {
    resolveAdminSession.mockReset();
    revalidateAccessSettings.mockReset();
    revalidateIntegrationHealth.mockReset();
    revalidateNewsletterSettings.mockReset();
    revalidateProjectSettings.mockReset();
    revalidateTag.mockReset();
    resolveAdminSession.mockResolvedValue(adminSession());
    runtime = await createStage1WebTestRuntime();
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("returns forbidden for non-admin org-sender creation", async () => {
    resolveAdminSession.mockResolvedValueOnce({
      ok: false,
      code: "forbidden"
    });

    const result = await createOrgSenderAction({
      email: "info@adventurescientists.org",
      label: "Adventure Scientists"
    });

    expect(result).toMatchObject({
      ok: false,
      code: "forbidden",
      message: "Only admins can add org senders."
    });
    expect(revalidateNewsletterSettings).not.toHaveBeenCalled();
  });

  it("rejects sender emails outside the verified domain", async () => {
    const result = await createOrgSenderAction({
      email: "info@example.org",
      label: "Adventure Scientists"
    });

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_email_domain",
      fieldErrors: {
        email: "Use an @adventurescientists.org sender address."
      }
    });
    expect(await listAllOrgSenders()).toHaveLength(0);
  });

  it("rejects duplicate sender emails without throwing", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    await createOrgSenderForTests(runtime, {
      email: "info@adventurescientists.org",
      label: "Adventure Scientists"
    });

    const result = await createOrgSenderAction({
      email: "info@adventurescientists.org",
      label: "Adventure Scientists"
    });

    expect(result).toMatchObject({
      ok: false,
      code: "already_exists",
      fieldErrors: {
        email: "That sender address is already configured."
      }
    });
  });

  it("creates an org sender, audits it, and revalidates newsletter settings", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    const result = await createOrgSenderAction({
      email: "info@adventurescientists.org",
      label: "Adventure Scientists"
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        email: "info@adventurescientists.org",
        label: "Adventure Scientists",
        enabled: true
      }
    });
    expect(revalidateNewsletterSettings).toHaveBeenCalledTimes(1);

    const created = result.ok ? result.data : null;
    const audits = created
      ? await runtime.context.repositories.auditEvidence.listByEntity({
          entityType: "org_sender",
          entityId: created.id
        })
      : [];

    expect(audits.at(-1)).toMatchObject({
      actorType: "user",
      actorId: "user:admin",
      action: "settings.org_sender.created",
      entityType: "org_sender",
      policyCode: "settings.admin_mutation"
    });
  });

  it("toggles an org sender enabled state", async () => {
    if (!runtime) throw new Error("runtime not initialized");

    const sender = await createOrgSenderForTests(runtime, {
      email: "info@adventurescientists.org",
      label: "Adventure Scientists"
    });

    const result = await setOrgSenderEnabledAction(sender.id, false);
    const updated = (await listAllOrgSenders()).find(
      (candidate) => candidate.id === sender.id
    );
    const audits = await runtime.context.repositories.auditEvidence.listByEntity({
      entityType: "org_sender",
      entityId: sender.id
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        id: sender.id,
        enabled: false
      }
    });
    expect(updated?.enabled).toBe(false);
    expect(audits.at(-1)).toMatchObject({
      actorId: "user:admin",
      action: "settings.org_sender.enabled_changed",
      entityType: "org_sender"
    });
    expect(revalidateNewsletterSettings).toHaveBeenCalledTimes(1);
  });

  it("returns forbidden for non-admin org-sender toggles", async () => {
    resolveAdminSession.mockResolvedValueOnce({
      ok: false,
      code: "forbidden"
    });

    const result = await setOrgSenderEnabledAction(
      "00000000-0000-0000-0000-000000000000",
      false
    );

    expect(result).toMatchObject({
      ok: false,
      code: "forbidden",
      message: "Only admins can update org senders."
    });
    expect(revalidateNewsletterSettings).not.toHaveBeenCalled();
  });
});
