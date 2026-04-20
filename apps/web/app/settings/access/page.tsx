import { redirect } from "next/navigation";

import { getCurrentUser, requireSession } from "@/src/server/auth/session";
import { recordSensitiveReadDetached } from "@/src/server/security/audit";

import { AccessSection } from "../_components/access-section";
import { SettingsContent } from "../_components/settings-content";
import { buildMockUsers } from "../_lib/mock-data";

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

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/auth/sign-in");
  }

  const users = buildMockUsers({
    id: currentUser.id,
    email: currentUser.email,
    name: currentUser.name
  });

  recordSensitiveReadDetached({
    actorId: currentUser.id,
    action: "settings.users.read",
    entityType: "settings_page",
    entityId: "users",
    metadataJson: {
      visibleUserCount: users.length
    }
  });

  const isAdmin = currentUser.role === "admin";

  return (
    <SettingsContent
      title="Access"
      description="Teammates with access to this workspace. Admins can change roles and deactivate accounts."
    >
      <AccessSection
        users={users}
        currentUserId={currentUser.id}
        isAdmin={isAdmin}
      />
    </SettingsContent>
  );
}
