import * as React from "react";
import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";

import type { InboxIntegrationHealthBannerViewModel } from "../_lib/integration-health";
import { TONE } from "@/app/_lib/design-tokens";

function formatServiceList(services: readonly string[]): string {
  if (services.length === 1) {
    return services[0] ?? "Integration";
  }

  return services.join(", ");
}

export function IntegrationHealthBanner({
  banner
}: {
  readonly banner: InboxIntegrationHealthBannerViewModel | null;
}) {
  if (banner === null) {
    return null;
  }

  const serviceList = formatServiceList(banner.degradedServices);
  const verb = banner.degradedServices.length === 1 ? "is" : "are";

  return (
    <div
      role="alert"
      className={`flex min-h-10 items-center gap-2 border-b px-4 py-2 ${TONE.amber.subtle} border-amber-200 text-amber-900`}
    >
      <AlertTriangleIcon className="h-4 w-4 shrink-0 text-amber-600" />
      <p className="min-w-0 flex-1 text-sm font-medium">
        {serviceList} integration {verb} degraded. Operators may not see new
        messages until resolved.
      </p>
      <Link
        href="/settings/integrations"
        className="shrink-0 text-sm font-semibold text-amber-950 underline-offset-4 hover:underline"
      >
        View status →
      </Link>
    </div>
  );
}
