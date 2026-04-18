import { redirect } from "next/navigation";

import { requireSession } from "@/src/server/auth/session";

export const dynamic = "force-dynamic";

export default async function OrganizationPage() {
  try {
    await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    throw error;
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 border-b border-slate-200 bg-white px-8 py-6">
        <h1 className="text-xl font-semibold tracking-tight text-slate-950">
          Organization
        </h1>
        <p className="text-sm text-slate-600">
          Workspace metadata and configuration.
        </p>
      </header>

      <div className="flex min-w-0 flex-1 flex-col px-8 py-6">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="divide-y divide-slate-100">
            <div className="flex items-center gap-4 px-6 py-4">
              <span className="w-40 shrink-0 text-sm font-medium text-slate-600">
                Organization
              </span>
              <span className="text-sm text-slate-900">
                Adventure Scientists
              </span>
            </div>
            <div className="flex items-center gap-4 px-6 py-4">
              <span className="w-40 shrink-0 text-sm font-medium text-slate-600">
                Timezone
              </span>
              <span className="text-sm text-slate-900">America/Denver</span>
            </div>
          </div>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Organization settings are currently managed via configuration.
          Runtime-editable settings will be available in a future release.
        </p>
      </div>
    </section>
  );
}
