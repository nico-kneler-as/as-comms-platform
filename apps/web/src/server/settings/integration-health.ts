import {
  integrationHealthCheckResponseSchema,
  integrationHealthServiceSchema,
  type IntegrationHealthRecord,
  type IntegrationHealthService
} from "@as-comms/contracts";

import { getSettingsRepositories } from "../stage1-runtime";

const refreshableServices = new Set<IntegrationHealthService>([
  "gmail",
  "salesforce"
]);

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

export function isMissingIntegrationHealthTableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const message =
    "message" in error && typeof error.message === "string" ? error.message : "";
  const code =
    "code" in error && typeof error.code === "string" ? error.code : null;

  return (
    code === "42P01" ||
    /relation ["']?integration_health["']? does not exist/iu.test(message)
  );
}

function buildUpdatedRecord(
  record: IntegrationHealthRecord,
  input: {
    readonly checkedAt: string;
    readonly status: IntegrationHealthRecord["status"];
    readonly detail: string | null;
    readonly metadataJson?: Record<string, unknown>;
  }
): IntegrationHealthRecord {
  return {
    ...record,
    status: input.status,
    lastCheckedAt: input.checkedAt,
    detail: input.detail,
    metadataJson: input.metadataJson ?? record.metadataJson,
    updatedAt: input.checkedAt
  };
}

function readCaptureBaseUrl(service: IntegrationHealthService): string | null {
  switch (service) {
    case "gmail": {
      const baseUrl = process.env.GMAIL_CAPTURE_BASE_URL?.trim();
      return baseUrl && baseUrl.length > 0 ? baseUrl : null;
    }
    case "salesforce": {
      const baseUrl = process.env.SALESFORCE_CAPTURE_BASE_URL?.trim();
      return baseUrl && baseUrl.length > 0 ? baseUrl : null;
    }
    default:
      return null;
  }
}

async function pollIntegrationHealthEndpoint(
  record: IntegrationHealthRecord,
  input?: {
    readonly fetchImplementation?: typeof fetch;
  }
): Promise<IntegrationHealthRecord> {
  const checkedAt = new Date().toISOString();

  if (!refreshableServices.has(record.id as IntegrationHealthService)) {
    return buildUpdatedRecord(record, {
      checkedAt,
      status: "not_configured",
      detail: null
    });
  }

  const baseUrl = readCaptureBaseUrl(record.id as IntegrationHealthService);
  if (baseUrl === null) {
    return buildUpdatedRecord(record, {
      checkedAt,
      status: "needs_attention",
      detail: "Capture service base URL is not configured."
    });
  }

  const fetchImplementation = input?.fetchImplementation ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    return buildUpdatedRecord(record, {
      checkedAt,
      status: "needs_attention",
      detail: "Global fetch is unavailable."
    });
  }

  let response: Response;

  try {
    response = await fetchImplementation(new URL("/health", baseUrl), {
      method: "GET",
      signal: AbortSignal.timeout(5_000)
    });
  } catch (error) {
    return buildUpdatedRecord(record, {
      checkedAt,
      status: "needs_attention",
      detail: isAbortError(error)
        ? "Health endpoint timed out."
        : "Health endpoint request failed."
    });
  }

  if (!response.ok) {
    return buildUpdatedRecord(record, {
      checkedAt,
      status: "needs_attention",
      detail: `Health endpoint returned status ${String(response.status)}.`
    });
  }

  try {
    const payload = integrationHealthCheckResponseSchema.parse(
      JSON.parse(await response.text()) as unknown
    );

    return buildUpdatedRecord(record, {
      checkedAt,
      status: payload.status,
      detail: payload.detail,
      metadataJson: {
        ...record.metadataJson,
        checkedAt: payload.checkedAt,
        version: payload.version
      }
    });
  } catch {
    return buildUpdatedRecord(record, {
      checkedAt,
      status: "needs_attention",
      detail: "Health endpoint returned malformed JSON."
    });
  }
}

export async function refreshIntegrationHealthRecord(
  rawServiceName: string,
  input?: {
    readonly fetchImplementation?: typeof fetch;
  }
): Promise<IntegrationHealthRecord> {
  const serviceName = integrationHealthServiceSchema.parse(rawServiceName);
  const repositories = await getSettingsRepositories();

  await repositories.integrationHealth.seedDefaults();
  const existingRecord = await repositories.integrationHealth.findById(serviceName);

  if (existingRecord === null) {
    throw new Error(`Missing integration health seed row for ${serviceName}.`);
  }

  const nextRecord = await pollIntegrationHealthEndpoint(existingRecord, input);
  return repositories.integrationHealth.upsert(nextRecord);
}
