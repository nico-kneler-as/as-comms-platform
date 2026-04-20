import { redirect } from "next/navigation";

import { getCurrentUser, requireSession } from "@/src/server/auth/session";
import { recordSensitiveReadDetached } from "@/src/server/security/audit";

import { AccessSection } from "./_components/access-section";
import { IntegrationsSection } from "./_components/integrations-section";
import { ProjectsSection } from "./_components/projects-section";
import {
  buildMockUsers,
  MOCK_INTEGRATIONS,
  MOCK_PROJECTS
} from "./_lib/mock-data";

export const dynamic = "force-dynamic";

/**
 * Single-page Settings surface.
 *
 * Replaces the previous multi-page `/settings/*` layout. Three stacked
 * sections — Projects, Access, Integrations — render top-to-bottom with
 * generous spacing. No tabs, no subpages.
 *
 * This is UI-only scaffolding: data comes from `_lib/mock-data.ts` and every
 * mutation is a stub in `./actions.ts` that returns a UiSuccess envelope
 * without touching persistence. See `TODO(stage2)` comments for wiring
 * points.
 *
 * The one piece of real behaviour preserved from the old multi-page version
 * is the `settings.users.read` sensitive-read audit — it still fires once
 * per render, from here, now that the Access section lives on this page.
 */
export default async function SettingsPage() {
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-10 sm:px-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
          Settings
        </h1>
        <p className="max-w-2xl text-sm text-slate-600">
          Configure routing, teammate access, and the providers this workspace
          depends on.
        </p>
      </header>

      <ProjectsSection projects={MOCK_PROJECTS} isAdmin={isAdmin} />

      <AccessSection
        users={users}
        currentUserId={currentUser.id}
        isAdmin={isAdmin}
      />

      <IntegrationsSection
        integrations={MOCK_INTEGRATIONS}
        isAdmin={isAdmin}
      />
    </div>
  );
}
