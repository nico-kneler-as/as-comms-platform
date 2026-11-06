import { afterEach, describe, expect, it } from "vitest";

import { createStage5RepositoryBundle } from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

type TestContext = Awaited<ReturnType<typeof createTestStage1Context>>;

function record(index: number, stateCode: "MT" | "ID" | null = "MT") {
  return {
    normalizedEmail: `person-${String(index)}@example.org`,
    stateCode,
    rawState: stateCode === "MT" ? "Montana" : stateCode === "ID" ? "Idaho" : "Bali",
    salesforceContactId: `003-${String(index)}`,
    salesforceLastModifiedAt: new Date("2026-11-06T12:00:00.000Z"),
  };
}

describe("Salesforce contact-states repository", () => {
  let context: TestContext | undefined;

  afterEach(async () => {
    await context?.dispose();
    context = undefined;
  });

  it("atomically replaces rows and removes stale ones", async () => {
    context = await createTestStage1Context();
    const repository = createStage5RepositoryBundle(context.db).salesforceContactStates;
    await repository.replaceAll([record(1), record(2, null)], new Date("2026-11-06T12:00:00.000Z"));
    await repository.replaceAll([record(3, "ID")], new Date("2026-11-06T13:00:00.000Z"));

    expect(await repository.countAll()).toBe(1);
    expect(await repository.findByEmails(["person-1@example.org", "person-3@example.org"])).toEqual(
      new Map([["person-3@example.org", "ID"]]),
    );
    expect(await repository.lastSyncedAt()).toEqual(new Date("2026-11-06T13:00:00.000Z"));
  });

  it("inserts large snapshots in chunks and rolls back a failed replacement", async () => {
    context = await createTestStage1Context();
    const repository = createStage5RepositoryBundle(context.db).salesforceContactStates;
    await repository.replaceAll([record(99)], new Date("2026-11-06T12:00:00.000Z"));
    await repository.replaceAll(
      Array.from({ length: 2_500 }, (_, index) => record(index)),
      new Date("2026-11-06T13:00:00.000Z"),
    );
    expect(await repository.countAll()).toBe(2_500);

    await expect(repository.replaceAll([
      record(1),
      { ...record(2), rawState: null as never },
    ], new Date("2026-11-06T14:00:00.000Z"))).rejects.toThrow();
    expect(await repository.countAll()).toBe(2_500);
  });

  it("returns known codes and nulls while omitting unknown emails across lookup chunks", async () => {
    context = await createTestStage1Context();
    const repository = createStage5RepositoryBundle(context.db).salesforceContactStates;
    await repository.replaceAll([record(1, "MT"), record(2, null)], new Date("2026-11-06T12:00:00.000Z"));
    const emails = Array.from({ length: 6_000 }, (_, index) => `unknown-${String(index)}@example.org`);
    emails.push("person-1@example.org", "person-2@example.org");

    expect(await repository.findByEmails(emails)).toEqual(new Map([
      ["person-1@example.org", "MT"],
      ["person-2@example.org", null],
    ]));
  });
});
