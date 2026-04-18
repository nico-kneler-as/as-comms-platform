/**
 * Session helpers for Server Components and Server Actions.
 *
 * Resolution order for the "current user":
 *   1. A valid Auth.js v5 session (production path, cookie-backed).
 *   2. Dev bypass mechanisms — ONLY honored when NODE_ENV !== "production":
 *      a. `x-dev-operator` request header (matches the Slice 2 brief; used
 *         by tests and internal tooling running against a dev build).
 *      b. `dev-session` cookie (seeded by `/api/dev-auth?email=...`).
 *
 * A deactivated operator always resolves to `null`, regardless of which
 * mechanism produced the candidate email. Role checks MUST happen on the
 * server — never serialize role/isAdmin flags into Client Components.
 */
import { cookies, headers } from "next/headers";

import type { UserRecord } from "@as-comms/domain";

import { getSettingsRepositories } from "../stage1-runtime";
import { auth } from "./index";

interface DevSessionPayload {
  readonly email?: string;
}

function parseDevSessionCookie(value: string): DevSessionPayload | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && "email" in parsed) {
      const email = (parsed as { email?: unknown }).email;
      if (typeof email === "string" && email.length > 0) {
        return { email };
      }
    }
  } catch {
    // fall through
  }
  return null;
}

async function resolveUserByEmail(email: string): Promise<UserRecord | null> {
  const { users } = await getSettingsRepositories();
  const record = await users.findByEmail(email);
  if (!record || record.deactivatedAt) {
    return null;
  }
  return record;
}

export async function getCurrentUser(): Promise<UserRecord | null> {
  const session = await auth();
  const sessionEmail = session?.user.email;
  if (sessionEmail) {
    const record = await resolveUserByEmail(sessionEmail);
    if (record) return record;
    return null;
  }

  if (process.env.NODE_ENV !== "production") {
    const headerList = await headers();
    const headerEmail = headerList.get("x-dev-operator");
    if (headerEmail) {
      const record = await resolveUserByEmail(headerEmail);
      if (record) return record;
    }

    const cookieStore = await cookies();
    const devSessionCookie = cookieStore.get("dev-session");
    if (devSessionCookie?.value) {
      const payload = parseDevSessionCookie(devSessionCookie.value);
      if (payload?.email) {
        const record = await resolveUserByEmail(payload.email);
        if (record) return record;
      }
    }
  }

  return null;
}

export async function requireSession(): Promise<UserRecord> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}

export async function requireAdmin(): Promise<UserRecord> {
  const user = await requireSession();
  if (user.role !== "admin") {
    throw new Error("FORBIDDEN");
  }
  return user;
}
