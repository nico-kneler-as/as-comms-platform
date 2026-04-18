import { redirect } from "next/navigation";

import { requireAdmin } from "@/src/server/auth/session";
import { getSettingsRepositories } from "@/src/server/stage1-runtime";

import { UsersTable, type UserRowViewModel } from "./_components/users-table";

export const dynamic = "force-dynamic";

function toUserRowViewModel(
  user: {
    readonly id: string;
    readonly email: string;
    readonly name: string | null;
    readonly role: "admin" | "operator";
    readonly deactivatedAt: Date | null;
  }
): UserRowViewModel {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isDeactivated: user.deactivatedAt !== null,
    deactivatedAt: user.deactivatedAt?.toISOString() ?? null
  };
}

export default async function UsersPage() {
  let currentUser;
  try {
    currentUser = await requireAdmin();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    // FORBIDDEN — signed in but not admin
    return (
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-col gap-1 border-b border-slate-200 bg-white px-8 py-6">
          <h1 className="text-xl font-semibold tracking-tight text-slate-950">
            Users &amp; Roles
          </h1>
        </header>
        <div className="px-8 py-6">
          <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-4">
            <p className="text-sm font-medium text-red-800">Access Denied</p>
            <p className="mt-1 text-sm text-red-700">
              This page is restricted to administrators.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const { users } = await getSettingsRepositories();
  const allUsers = await users.listAll();

  const rows: readonly UserRowViewModel[] = allUsers.map(toUserRowViewModel);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 border-b border-slate-200 bg-white px-8 py-6">
        <h1 className="text-xl font-semibold tracking-tight text-slate-950">
          Users &amp; Roles
        </h1>
        <p className="text-sm text-slate-600">
          Manage who has access to this workspace and what they can do. Admins
          can change roles and deactivate accounts.
        </p>
      </header>

      <div className="flex min-w-0 flex-1 flex-col px-8 py-6">
        <UsersTable rows={rows} currentUserId={currentUser.id} />
      </div>
    </section>
  );
}
