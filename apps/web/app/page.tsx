import { redirect } from "next/navigation";

import { requireSession } from "@/src/server/auth/session";
import {
  firstAccessibleSurface,
  loadWorkspaceAccess,
} from "@/src/server/auth/workspace-access";

export default async function HomePage() {
  const user = await requireSession().catch((error: unknown) => {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    throw error;
  });
  const destination = firstAccessibleSurface(await loadWorkspaceAccess(user));
  redirect(destination ?? "/auth/sign-in");
}
