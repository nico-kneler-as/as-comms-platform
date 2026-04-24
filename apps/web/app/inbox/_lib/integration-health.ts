import type { IntegrationHealthRecord } from "@as-comms/contracts";

import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

const INBOX_HEALTH_SERVICE_IDS = ["gmail", "salesforce"] as const;

export interface InboxIntegrationHealthBannerViewModel {
  readonly degradedServices: readonly string[];
}

function isInboxHealthService(
  value: string
): value is (typeof INBOX_HEALTH_SERVICE_IDS)[number] {
  return INBOX_HEALTH_SERVICE_IDS.includes(
    value as (typeof INBOX_HEALTH_SERVICE_IDS)[number]
  );
}

export function buildInboxIntegrationHealthBannerViewModel(
  rows: readonly IntegrationHealthRecord[]
): InboxIntegrationHealthBannerViewModel | null {
  const degradedServices = rows
    .filter(
      (row) => isInboxHealthService(row.id) && row.status !== "healthy"
    )
    .map((row) => row.serviceName);

  if (degradedServices.length === 0) {
    return null;
  }

  return {
    degradedServices
  };
}

export async function getInboxIntegrationHealthBanner(): Promise<InboxIntegrationHealthBannerViewModel | null> {
  const runtime = await getStage1WebRuntime();

  await runtime.settings.integrationHealth.seedDefaults();
  const rows = await runtime.settings.integrationHealth.listAll();

  return buildInboxIntegrationHealthBannerViewModel(rows);
}

