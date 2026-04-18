// Importing the JWT module for its side effects (side-effect-only imports
// are necessary for module-augmentation-only .d.ts files — without this,
// TypeScript never loads the base `JWT` interface so our augmentation
// never merges and `token.role` falls back to `{}`).
import "next-auth/jwt";

import type { UserRole } from "@as-comms/domain";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role?: UserRole;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: UserRole;
  }
}
