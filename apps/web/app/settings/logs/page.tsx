import { redirect } from "next/navigation";

import { resolveAdminSession } from "@/src/server/auth/api";
import { loadLogsSettings } from "@/src/server/settings/selectors";

import { LogsPage } from "../_components/logs-page";
import { SettingsContent } from "../_components/settings-content";

export const dynamic = "force-dynamic";

export default async function SettingsLogsPage({
  searchParams
}: {
  readonly searchParams: Promise<{
    readonly stream?: string;
    readonly before?: string;
  }>;
}) {
  const session = await resolveAdminSession();
  if (!session.ok) {
    redirect(session.code === "unauthorized" ? "/auth/sign-in" : "/settings");
  }

  const params = await searchParams;
  const viewModel = await loadLogsSettings({
    streamId: params.stream ?? "source-evidence-quarantine",
    beforeTimestamp: params.before ?? null
  });

  return (
    <SettingsContent>
      <LogsPage viewModel={viewModel} />
    </SettingsContent>
  );
}
