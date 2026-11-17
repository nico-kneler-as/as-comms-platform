import { readFile } from "node:fs/promises";

import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createTestStage1Context } from "./helpers.js";

type Context = Awaited<ReturnType<typeof createTestStage1Context>>;
let contexts: Context[] = [];

afterEach(async () => {
  await Promise.all(contexts.map((context) => context.dispose()));
  contexts = [];
});

/** The data statements of migration 0104 (everything after the ALTER). */
async function readDataStatements(): Promise<readonly string[]> {
  const migration = await readFile(
    new URL("../drizzle/0104_org_sender_display_name.sql", import.meta.url),
    "utf8",
  );
  return migration
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter((part) => /^(--[^\n]*\n)*UPDATE/u.test(part));
}

function rows(result: unknown): readonly Record<string, unknown>[] {
  return (result as { rows?: readonly Record<string, unknown>[] }).rows ?? [];
}

describe("migration 0104: org sender display name", () => {
  it("moves Gregg's sender and open drafts to gtreinish@, keeping sent history", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    await context.db.execute(sql`
      insert into org_senders (email, label) values
        ('info@adventurescientists.org', 'Adventure Scientists'),
        ('gregg@adventurescientists.org', 'Gregg Treinish - Adventure Scientists')
    `);
    await context.db.execute(sql`
      insert into campaign_runs (id, kind, launch_type, state, from_email, from_name, reply_to_email, audience_criteria, created_at, updated_at)
      values
        ('run-draft', 'newsletter', 'normal_email', 'draft', 'gregg@adventurescientists.org', 'Adventure Scientists', 'gregg@adventurescientists.org', '{}'::jsonb, now(), now()),
        ('run-sent', 'newsletter', 'normal_email', 'complete', 'gregg@adventurescientists.org', 'Adventure Scientists', 'gregg@adventurescientists.org', '{}'::jsonb, now(), now())
    `);

    for (const statement of await readDataStatements()) {
      await context.client.exec(statement);
    }

    expect(
      rows(
        await context.db.execute(
          sql`select email, display_name from org_senders order by email`,
        ),
      ),
    ).toEqual([
      { email: "gtreinish@adventurescientists.org", display_name: "Gregg Treinish" },
      { email: "info@adventurescientists.org", display_name: "Adventure Scientists" },
    ]);
    expect(
      rows(
        await context.db.execute(
          sql`select id, from_email, from_name, reply_to_email from campaign_runs order by id`,
        ),
      ),
    ).toEqual([
      {
        id: "run-draft",
        from_email: "gtreinish@adventurescientists.org",
        from_name: null,
        reply_to_email: "gtreinish@adventurescientists.org",
      },
      {
        id: "run-sent",
        from_email: "gregg@adventurescientists.org",
        from_name: "Adventure Scientists",
        reply_to_email: "gregg@adventurescientists.org",
      },
    ]);
  });
});

describe("migration 0105: org sender signature and minimal footer", () => {
  it("turns on the minimal footer for Gregg's sender only", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    await context.db.execute(sql`
      insert into org_senders (email, label) values
        ('info@adventurescientists.org', 'Adventure Scientists'),
        ('gtreinish@adventurescientists.org', 'Gregg Treinish')
    `);
    const migration = await readFile(
      new URL("../drizzle/0105_org_sender_signature_minimal_footer.sql", import.meta.url),
      "utf8",
    );
    const update = migration
      .split("--> statement-breakpoint")
      .map((part) => part.trim())
      .find((part) => part.startsWith("UPDATE"));
    if (update === undefined) {
      throw new Error("UPDATE statement not found in migration 0105.");
    }

    await context.client.exec(update);

    expect(
      rows(
        await context.db.execute(
          sql`select email, minimal_footer, signature from org_senders order by email`,
        ),
      ),
    ).toEqual([
      { email: "gtreinish@adventurescientists.org", minimal_footer: true, signature: "" },
      { email: "info@adventurescientists.org", minimal_footer: false, signature: "" },
    ]);
  });
});
