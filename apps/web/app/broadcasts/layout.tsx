import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { PrimaryIconRail } from "@/app/_components/primary-icon-rail";
import {
  railAccessFor,
  requireWorkspace,
} from "@/src/server/auth/workspace-access";

export const metadata = {
  title: "Broadcasts",
};

export const dynamic = "force-dynamic";

export default async function CampaignsLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const access = await requireWorkspace("volunteers").catch((error: unknown) => {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      redirect("/");
    }
    throw error;
  });
  const currentUser = access.user;

  return (
    <div className="flex min-h-dvh w-full bg-slate-100 text-slate-900 antialiased">
      <PrimaryIconRail
        access={railAccessFor(access)}
        operator={{
          initials: getInitials(currentUser.name ?? currentUser.email),
          displayName: currentUser.name ?? currentUser.email,
          email: currentUser.email,
        }}
      />
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

function getInitials(value: string): string {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
