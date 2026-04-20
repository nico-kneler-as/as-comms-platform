import { redirect } from "next/navigation";

import { getCurrentUser, requireSession } from "@/src/server/auth/session";

import { IntegrationsSection } from "../_components/integrations-section";
import { SettingsContent } from "../_components/settings-content";
import { MOCK_INTEGRATIONS } from "../_lib/mock-data";

export const dynamic = "force-dynamic";

export default async function SettingsIntegrationsPage() {
  try {
    await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    throw error;
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/auth/sign-in");
  }

  const isAdmin = currentUser.role === "admin";

  return (
    <SettingsContent>
      <IntegrationsSection
        integrations={MOCK_INTEGRATIONS}
        isAdmin={isAdmin}
      />
    </SettingsContent>
  );
}
