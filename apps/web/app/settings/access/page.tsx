import { redirect } from "next/navigation";

import { requireSession } from "@/src/server/auth/session";
import { loadAccessSettings } from "@/src/server/settings/selectors";

import { AccessSection } from "../_components/access-section";
import { SettingsContent } from "../_components/settings-content";

export const dynamic = "force-dynamic";

/**
 * Access section — teammates, roles, last sign-in. This is the only settings
 * sub-route that exposes user PII, so the `settings.users.read` sensitive-read
 * audit fires from here (moved off the previous single-page `/settings`).
 */
export default async function SettingsAccessPage() {
  try {
    await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    throw error;
  }

  const viewModel = await loadAccessSettings();

  return (
    <SettingsContent>
      <AccessSection viewModel={viewModel} />
    </SettingsContent>
  );
}
