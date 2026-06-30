import { redirect } from "next/navigation";

import { requireSession } from "@/src/server/auth/session";
import { loadOrgSendersSettings } from "@/src/server/settings/selectors";

import { NewsletterSection } from "../_components/newsletter-section";
import { SettingsContent } from "../_components/settings-content";

export const dynamic = "force-dynamic";

export default async function SettingsNewsletterPage() {
  try {
    await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    throw error;
  }

  const viewModel = await loadOrgSendersSettings();

  return (
    <SettingsContent>
      <NewsletterSection viewModel={viewModel} />
    </SettingsContent>
  );
}
