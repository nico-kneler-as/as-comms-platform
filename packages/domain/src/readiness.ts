import {
  stage0ReadinessReportSchema,
  type ReadinessCheck,
  type Stage0ReadinessReport
} from "@as-comms/contracts";

export interface Stage0ReadinessInput {
  readonly databaseConfigured: boolean;
  readonly workerConfigured: boolean;
  readonly boundariesConfigured: boolean;
}

function deriveOverallStatus(checks: readonly ReadinessCheck[]): "ok" | "warn" | "fail" {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }

  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }

  return "ok";
}

export function buildStage0ReadinessReport(
  input: Stage0ReadinessInput
): Stage0ReadinessReport {
  const checks: Stage0ReadinessReport["checks"] = [
    {
      name: "database-connection-string",
      status: input.databaseConfigured ? "ok" : "warn",
      message: input.databaseConfigured
        ? "A server-side database URL is configured."
        : "Set DATABASE_URL before enabling DB-backed Stage 1 work."
    },
    {
      name: "worker-runtime-boundary",
      status: input.workerConfigured ? "ok" : "warn",
      message: input.workerConfigured
        ? "A worker connection string is available for background jobs."
        : "Set WORKER_DATABASE_URL or DATABASE_URL before running the worker."
    },
    {
      name: "package-boundaries",
      status: input.boundariesConfigured ? "ok" : "fail",
      message: input.boundariesConfigured
        ? "Stage 0 package boundaries are wired into repository checks."
        : "Boundary enforcement must exist before Stage 1 begins."
    }
  ];

  const report: Stage0ReadinessReport = {
    stage: 0,
    status: deriveOverallStatus(checks),
    generatedAt: new Date().toISOString(),
    checks
  };

  return stage0ReadinessReportSchema.parse(report);
}
