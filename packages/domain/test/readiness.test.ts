import { describe, expect, it } from "vitest";

import type { Stage0ReadinessReport } from "@as-comms/contracts";
import { buildStage0ReadinessReport } from "../src/index.js";

describe("buildStage0ReadinessReport", () => {
  it("warns until DB and worker configuration are supplied", () => {
    const report: Stage0ReadinessReport = buildStage0ReadinessReport({
      databaseConfigured: false,
      workerConfigured: false,
      boundariesConfigured: true
    });

    expect(report.status).toBe("warn");
    expect(report.checks).toHaveLength(3);
    expect(report.checks[0]?.status).toBe("warn");
    expect(report.checks[1]?.status).toBe("warn");
    expect(report.checks[2]?.status).toBe("ok");
  });

  it("returns ok once all Stage 0 prerequisites are present", () => {
    const report: Stage0ReadinessReport = buildStage0ReadinessReport({
      databaseConfigured: true,
      workerConfigured: true,
      boundariesConfigured: true
    });

    expect(report.status).toBe("ok");
  });
});
