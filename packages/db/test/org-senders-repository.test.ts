import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { orgSenders } from "../src/index.js";
import {
  createOrgSender,
  getOrgSenderByEmail,
  getOrgSenderById,
  listOrgSenders,
  setOrgSenderEnabled,
} from "../src/org-senders-repository.js";
import { createTestStage1Context, type TestStage1Context } from "./helpers.js";

describe("org senders repository", () => {
  let context: TestStage1Context;

  beforeEach(async () => {
    context = await createTestStage1Context();
  });

  afterEach(async () => {
    await context.dispose();
  });

  it("creates an org sender and fetches it by id and email", async () => {
    const created = await createOrgSender(context.db, {
      email: "info@adventurescientists.org",
      label: "Adventure Scientists Newsletter",
    });

    const byId = await getOrgSenderById(context.db, created.id);
    const byEmail = await getOrgSenderByEmail(
      context.db,
      "info@adventurescientists.org",
    );

    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(byId).toEqual(created);
    expect(byEmail).toEqual(created);
  });

  it("lists rows by created_at and enabledOnly excludes disabled senders", async () => {
    const older = await createOrgSender(context.db, {
      email: "older@adventurescientists.org",
      label: "Older Sender",
    });
    const newer = await createOrgSender(context.db, {
      email: "newer@adventurescientists.org",
      label: "Newer Sender",
    });

    await context.db
      .update(orgSenders)
      .set({ createdAt: new Date("2026-06-19T10:00:00.000Z") })
      .where(eq(orgSenders.id, older.id));
    await context.db
      .update(orgSenders)
      .set({ createdAt: new Date("2026-06-19T11:00:00.000Z") })
      .where(eq(orgSenders.id, newer.id));
    await setOrgSenderEnabled(context.db, older.id, false);

    const listed = await listOrgSenders(context.db);
    const enabledOnly = await listOrgSenders(context.db, { enabledOnly: true });

    expect(listed.map((sender) => sender.id)).toEqual([older.id, newer.id]);
    expect(enabledOnly.map((sender) => sender.id)).toEqual([newer.id]);
  });

  it("drops a disabled sender from the enabledOnly list", async () => {
    const created = await createOrgSender(context.db, {
      email: "newsletter@adventurescientists.org",
      label: "Newsletter",
    });

    await setOrgSenderEnabled(context.db, created.id, false);

    const enabledOnly = await listOrgSenders(context.db, { enabledOnly: true });
    const fetched = await getOrgSenderById(context.db, created.id);

    expect(enabledOnly).toHaveLength(0);
    expect(fetched?.enabled).toBe(false);
  });

  it("rejects duplicate email inserts", async () => {
    await createOrgSender(context.db, {
      email: "info@adventurescientists.org",
      label: "Primary",
    });

    await expect(
      createOrgSender(context.db, {
        email: "info@adventurescientists.org",
        label: "Duplicate",
      }),
    ).rejects.toThrow();
  });
});
