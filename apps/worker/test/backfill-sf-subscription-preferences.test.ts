import { describe, expect, it } from "vitest";

import type { SubscriptionBackfillInput } from "@as-comms/domain";
import { SalesforceWriteError, type SalesforceWriteClient } from "@as-comms/integrations";

import {
  runSubscriptionBackfill,
  type SubscriptionBackfillFileSystem,
  type SubscriptionBackfillLoader,
} from "../src/ops/backfill-sf-subscription-preferences.js";

class MemoryFs implements SubscriptionBackfillFileSystem {
  readonly files = new Map<string, string>();
  mkdir = (): Promise<void> => Promise.resolve();
  readFile = (path: string): Promise<string> => Promise.resolve(this.files.get(path) ?? "");
  writeFile = (path: string, data: string): Promise<void> => { this.files.set(path, data); return Promise.resolve(); };
}

const resolved = <T>(value: T): Promise<T> => Promise.resolve(value);
const noop = (): void => undefined;

const input = (): SubscriptionBackfillInput => ({
  contacts: [
    { salesforceContactId: "003one", email: "one@example.org", hasOptedOutOfEmail: false, doNotContact: false },
    { salesforceContactId: "003two", email: "two@example.org", hasOptedOutOfEmail: false, doNotContact: false },
  ],
  memberships: [], projectBoxes: [], connectedProjects: [], existing: [],
  newsletterSubscribers: [], newsletterSuppressions: [], suppressionList: [], consents: [],
  creationSource: "Platform backfill 2026-11",
});
const loader = (newer = new Set<string>()): SubscriptionBackfillLoader => ({
  load: () => resolved({ snapshotAt: "2026-11-10T00:00:00.000Z", input: input() }),
  newerPlatformChangeEmails: () => resolved(newer),
});
const writer = (run: (changes: readonly { email: string }[]) => Promise<readonly unknown[]>): SalesforceWriteClient => ({
  upsertSubscriptionPreferences: run as SalesforceWriteClient["upsertSubscriptionPreferences"],
  setExpeditionMemberStatus: () => resolved(undefined),
});

describe("backfill-sf-subscription-preferences", () => {
  it("writes dry-run artifacts and never calls a writer", async () => {
    const fs = new MemoryFs(); let calls = 0;
    const status = await runSubscriptionBackfill(["--out", "/out"], {
      loader: loader(), fileSystem: fs,
      writeClient: writer(() => { calls += 1; return resolved([]); }),
      logger: { log: noop, error: noop },
    });
    expect(status).toBe(0); expect(calls).toBe(0);
    expect(fs.files.get("/out/diff.csv")).toContain("one@example.org");
    expect(fs.files.get("/out/plan-summary.json")).toContain('"mode": "dry_run"');
  });

  it("rejects execute runs missing or mismatching expected write count before writer calls", async () => {
    let calls = 0; const client = writer(() => { calls += 1; return resolved([]); });
    await expect(runSubscriptionBackfill(["--out", "/out", "--execute"], { loader: loader(), writeClient: client })).rejects.toThrow("--expect-writes");
    await expect(runSubscriptionBackfill(["--out", "/out", "--execute", "--expect-writes", "1"], { loader: loader(), writeClient: client })).rejects.toThrow("--expect-writes");
    expect(calls).toBe(0);
  });

  it("filters pilot emails, records unknown ones, and chunks with injected pauses", async () => {
    const fs = new MemoryFs(); fs.files.set("/emails", "ONE@example.org\nmissing@example.org\n");
    const calls: number[] = []; const pauses: number[] = [];
    await runSubscriptionBackfill(["--out", "/out", "--execute", "--expect-writes", "1", "--emails", "/emails", "--chunk-size", "1"], {
      loader: loader(), fileSystem: fs, sleep: (milliseconds) => { pauses.push(milliseconds); return resolved(undefined); },
      writeClient: writer((changes) => { calls.push(changes.length); return resolved(changes.map((change) => ({ email: change.email, outcome: "created", salesforceId: "a01", error: null }))); }),
      logger: { log: noop, error: noop },
    });
    expect(calls).toEqual([1]); expect(pauses).toEqual([]);
    expect(fs.files.get("/out/results.csv")).toContain("not_in_plan");
  });

  it("pauses between full-run chunks and skips an email changed after the snapshot", async () => {
    const fs = new MemoryFs(); const pauses: number[] = []; const calls: string[] = [];
    await runSubscriptionBackfill(["--out", "/out", "--execute", "--expect-writes", "2", "--chunk-size", "1", "--pause-seconds", "7"], {
      loader: loader(new Set(["one@example.org"])), fileSystem: fs,
      sleep: (milliseconds) => { pauses.push(milliseconds); return resolved(undefined); },
      writeClient: writer((changes) => { calls.push(...changes.map((change) => change.email)); return resolved(changes.map((change) => ({ email: change.email, outcome: "created", salesforceId: "a01", error: null }))); }),
      logger: { log: noop, error: noop },
    });
    expect(calls).toEqual(["two@example.org"]); expect(pauses).toEqual([7_000]);
    expect(fs.files.get("/out/results.csv")).toContain("skipped_newer_platform_change");
  });

  it("records each row once when a whole call is denied part-way", async () => {
    const fs = new MemoryFs();
    const status = await runSubscriptionBackfill(["--out", "/denied", "--execute", "--expect-writes", "2"], {
      loader: loader(), fileSystem: fs, sleep: () => resolved(undefined),
      writeClient: writer(() => Promise.reject(new SalesforceWriteError("denied", "permission", 403, "INSUFFICIENT_ACCESS_OR_READONLY", [
        { email: "one@example.org", outcome: "created", salesforceId: "a01", error: null },
      ]))),
      logger: { log: noop, error: noop },
    });
    expect(status).toBe(1);
    const rows = (fs.files.get("/denied/results.csv") ?? "").trim().split("\n").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.startsWith("one@example.org"))).toContain(",created,");
    expect(rows.find((row) => row.startsWith("two@example.org"))).toContain(",failed,");
    expect(rows.join("\n")).toContain("permission");
    expect(rows.join("\n")).not.toContain("MISSING_RESULT");
  });

  it("rejects a zero chunk size", async () => {
    await expect(runSubscriptionBackfill(["--out", "/out", "--chunk-size", "0"], { loader: loader() })).rejects.toThrow("--chunk-size");
  });

  it("retries transient record failures and stops on permission errors without logging emails", async () => {
    const fs = new MemoryFs(); let attempts = 0;
    const transientStatus = await runSubscriptionBackfill(["--out", "/out", "--execute", "--expect-writes", "2"], {
      loader: loader(), fileSystem: fs, sleep: () => resolved(undefined),
      writeClient: writer((changes) => {
        attempts += 1;
        return resolved(changes.map((change, index) => index === 0 && attempts === 1
          ? { email: change.email, outcome: "failed", salesforceId: null, error: { kind: "transient", code: "LOCK", message: "" } }
          : { email: change.email, outcome: "created", salesforceId: "a01", error: null }));
      }),
      logger: { log: noop, error: noop },
    });
    expect(attempts).toBeGreaterThan(1); expect(transientStatus).toBe(0);
    const logs: unknown[] = [];
    const status = await runSubscriptionBackfill(["--out", "/permission", "--execute", "--expect-writes", "2"], {
      loader: loader(), fileSystem: fs,
      writeClient: writer((changes) => resolved(changes.map((change) => ({ email: change.email, outcome: "failed", salesforceId: null, error: { kind: "permission", code: "DENIED", message: "" } })))),
      logger: { log: (...args) => logs.push(...args), error: noop },
    });
    expect(status).toBe(1);
    expect(fs.files.get("/permission/results.csv")).toContain("permission");
    expect(logs.join(" ")).not.toContain("one@example.org");
  });
});
