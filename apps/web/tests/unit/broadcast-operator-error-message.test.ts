import { afterEach, describe, expect, it, vi } from "vitest";

import { toOperatorErrorMessage } from "../../app/broadcasts/_lib/operator-error-message";

const FALLBACK = "Unable to start the broadcast send. Nothing was sent.";

describe("toOperatorErrorMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes short operator-facing errors through unchanged", () => {
    expect(
      toOperatorErrorMessage(
        new Error("Campaign run run-1 cannot be frozen from cancelled."),
        FALLBACK,
        "broadcast.send_now_failed",
      ),
    ).toBe("Campaign run run-1 cannot be frozen from cancelled.");
  });

  it("falls back for non-Error throws", () => {
    expect(
      toOperatorErrorMessage("boom", FALLBACK, "broadcast.send_now_failed"),
    ).toBe(FALLBACK);
  });

  it("never returns or logs the bound params of a failed query", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const error = new Error(
      'Failed query: insert into "audience_snapshots" values ($1, $2)\nparams: volunteer@example.org,Pat',
      { cause: new Error("Max number of parameters (65534) exceeded") },
    );

    expect(
      toOperatorErrorMessage(error, FALLBACK, "broadcast.send_now_failed"),
    ).toBe(FALLBACK);

    const logged = String(consoleError.mock.calls[0]?.[0]);
    expect(logged).toContain("broadcast.send_now_failed");
    expect(logged).toContain("Max number of parameters (65534) exceeded");
    expect(logged).toContain('insert into \\"audience_snapshots\\"');
    expect(logged).not.toContain("volunteer@example.org");
    expect(logged).not.toContain("Pat");
  });

  it("falls back for oversized messages", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(
      toOperatorErrorMessage(
        new Error("x".repeat(301)),
        FALLBACK,
        "broadcast.send_now_failed",
      ),
    ).toBe(FALLBACK);
  });
});
