import { redirect } from "next/navigation";

import { getCurrentUser, requireSession } from "@/src/server/auth/session";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import { AliasesTable, type AliasRowViewModel, type ProjectOption } from "./_components/aliases-table";

/**
 * Operators can view project aliases; admins can mutate. The DB-backed
 * session check lives in the shared layout, so the page only needs to
 * resolve the current user for the isAdmin flag.
 */
export const dynamic = "force-dynamic";

function toAliasRowViewModel(
  alias: { readonly id: string; readonly alias: string; readonly projectId: string | null },
  projectNameById: ReadonlyMap<string, string>
): AliasRowViewModel {
  const base: AliasRowViewModel = {
    id: alias.id,
    alias: alias.alias,
    projectId: alias.projectId
  };
  const projectName =
    alias.projectId === null
      ? undefined
      : projectNameById.get(alias.projectId);
  if (projectName === undefined) {
    return base;
  }
  return { ...base, projectName };
}

export default async function ProjectAliasesPage() {
  try {
    await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    throw error;
  }

  const currentUser = await getCurrentUser();
  // requireSession succeeded above, so currentUser is non-null here. Narrow
  // explicitly (no `!`) to satisfy strict null checks without relying on
  // non-null assertions banned by the project style guide.
  if (!currentUser) {
    redirect("/auth/sign-in");
  }

  const runtime = await getStage1WebRuntime();
  const [aliasRecords, projectRecords] = await Promise.all([
    runtime.settings.aliases.listAll(),
    runtime.repositories.projectDimensions.listAll()
  ]);

  const projectNameById = new Map<string, string>(
    projectRecords.map((project) => [project.projectId, project.projectName])
  );

  const rows: readonly AliasRowViewModel[] = aliasRecords.map((record) =>
    toAliasRowViewModel(record, projectNameById)
  );

  const projectOptions: readonly ProjectOption[] = projectRecords.map(
    (project) => ({
      id: project.projectId,
      name: project.projectName
    })
  );

  const isAdmin = currentUser.role === "admin";

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 border-b border-slate-200 bg-white px-8 py-6">
        <h1 className="text-xl font-semibold tracking-tight text-slate-950">
          Project Aliases
        </h1>
        <p className="text-sm text-slate-600">
          Map inbox email addresses to the projects they belong to. Aliases
          without a project remain visible in the shared inbox.
        </p>
      </header>

      <div className="flex min-w-0 flex-1 flex-col px-8 py-6">
        <AliasesTable
          rows={rows}
          projectOptions={projectOptions}
          isAdmin={isAdmin}
        />
      </div>
    </section>
  );
}
