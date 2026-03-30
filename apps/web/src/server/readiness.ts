import {
  serviceHealthSchema,
  type ServiceHealth,
  type Stage0ReadinessReport
} from "@as-comms/contracts";
import { buildStage0ReadinessReport } from "@as-comms/domain";

export function getStage0HealthSnapshot(): ServiceHealth {
  return serviceHealthSchema.parse({
    service: "web",
    stage: 0,
    status: "ok",
    generatedAt: new Date().toISOString()
  });
}

export function getStage0ReadinessSnapshot(): Stage0ReadinessReport {
  return buildStage0ReadinessReport({
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    workerConfigured: Boolean(process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL),
    boundariesConfigured: true
  });
}
