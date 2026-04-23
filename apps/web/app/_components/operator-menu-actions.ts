"use server";

import { signOut } from "@/src/server/auth";

export async function signOutOperatorAction() {
  await signOut({
    redirectTo: "/auth/sign-in"
  });
}
