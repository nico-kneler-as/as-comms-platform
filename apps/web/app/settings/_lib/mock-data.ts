// TODO(stage2): DB enum `user_role` currently stores `admin | operator`.
// When wiring real persistence, either (a) migrate the enum to
// `admin | internal_user` or (b) map `internal_user` → `operator` at the
// repository boundary. UI labels should stay `internal_user` per product.
//
// This file is UI-only scaffolding: all data is hard-coded and all mutations
// are stubbed in `apps/web/app/settings/actions.ts`. Replace with real
// repositories when persistence is wired.

export interface MockProject {
  readonly id: string;
  readonly name: string;
  readonly inboxAlias: string;
  readonly active: boolean;
}

export interface MockUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: "admin" | "internal_user";
  readonly isDeactivated: boolean;
  readonly lastSignInAt: string | null;
}

export type MockIntegrationStatus =
  | "connected"
  | "degraded"
  | "disconnected"
  | "not_configured";

export type MockIntegrationCategory = "crm" | "messaging" | "knowledge" | "ai";

export interface MockIntegration {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: MockIntegrationCategory;
  readonly status: MockIntegrationStatus;
  readonly lastSyncAt: string | null;
  readonly logo: string;
}

export const MOCK_PROJECTS: readonly MockProject[] = [
  {
    id: "project:killer-whales",
    name: "Searching for Killer Whales",
    inboxAlias: "killer-whales@asc.internal",
    active: true
  },
  {
    id: "project:coral-reefs",
    name: "Monitoring Coral Reefs",
    inboxAlias: "coral-reefs@asc.internal",
    active: true
  },
  {
    id: "project:butternut-beech",
    name: "Butternut and Beech",
    inboxAlias: "butternut-beech@asc.internal",
    active: true
  },
  {
    id: "project:pnw-forest-biodiversity",
    name: "PNW Forest Biodiversity",
    inboxAlias: "pnw-forest@asc.internal",
    active: false
  }
];

/**
 * Seed set used when the signed-in user is not already in the list. The
 * `buildMockUsers` helper replaces the first admin entry with the live
 * session user so the table always reflects "you" in a stable position.
 */
const BASE_MOCK_USERS: readonly MockUser[] = [
  {
    id: "user:admin-seed",
    email: "admin@adventurescientists.org",
    name: "Workspace Admin",
    role: "admin",
    isDeactivated: false,
    lastSignInAt: "2026-04-20T15:12:00.000Z"
  },
  {
    id: "user:maya-osei",
    email: "maya.osei@adventurescientists.org",
    name: "Maya Osei",
    role: "internal_user",
    isDeactivated: false,
    lastSignInAt: "2026-04-19T22:45:00.000Z"
  },
  {
    id: "user:juan-ramirez",
    email: "juan.ramirez@adventurescientists.org",
    name: "Juan Ramírez",
    role: "internal_user",
    isDeactivated: false,
    lastSignInAt: "2026-04-18T08:10:00.000Z"
  },
  {
    id: "user:ellen-park",
    email: "ellen.park@adventurescientists.org",
    name: "Ellen Park",
    role: "internal_user",
    isDeactivated: false,
    lastSignInAt: "2026-04-17T17:02:00.000Z"
  },
  {
    id: "user:devon-lee",
    email: "devon.lee@adventurescientists.org",
    name: "Devon Lee",
    role: "internal_user",
    isDeactivated: true,
    lastSignInAt: "2026-03-11T09:33:00.000Z"
  }
];

interface CurrentUserSeed {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
}

/**
 * Returns the mock user list with the signed-in user injected as the first
 * admin row. Keeps "you" visually pinned to the top of the Access table so
 * self-action guards are obvious without scanning.
 */
export function buildMockUsers(
  currentUser: CurrentUserSeed
): readonly MockUser[] {
  const already = BASE_MOCK_USERS.find(
    (user) => user.email.toLowerCase() === currentUser.email.toLowerCase()
  );

  if (already) {
    // Promote the existing row to admin and keep the real DB id so row
    // identity (used for self-action guards) matches the session user.
    const replaced: MockUser = {
      ...already,
      id: currentUser.id,
      name: currentUser.name ?? already.name,
      role: "admin",
      isDeactivated: false
    };
    return BASE_MOCK_USERS.map((user) =>
      user.id === already.id ? replaced : user
    );
  }

  const injected: MockUser = {
    id: currentUser.id,
    email: currentUser.email,
    name: currentUser.name,
    role: "admin",
    isDeactivated: false,
    lastSignInAt: new Date().toISOString()
  };

  // Drop the seed admin so we keep the total at ~5 users.
  const rest = BASE_MOCK_USERS.filter((user) => user.id !== "user:admin-seed");
  return [injected, ...rest];
}

export const MOCK_INTEGRATIONS: readonly MockIntegration[] = [
  {
    id: "integration:salesforce",
    name: "Salesforce",
    description:
      "Source of truth for volunteer contacts, projects, and participation history.",
    category: "crm",
    status: "connected",
    lastSyncAt: "2026-04-20T14:58:00.000Z",
    logo: "SF"
  },
  {
    id: "integration:gmail",
    name: "Gmail",
    description:
      "Routes incoming mail to project inboxes and sends replies on behalf of operators.",
    category: "messaging",
    status: "connected",
    lastSyncAt: "2026-04-20T15:03:00.000Z",
    logo: "G"
  },
  {
    id: "integration:simpletexting",
    name: "SimpleTexting",
    description:
      "Two-way SMS channel for volunteer check-ins and field-support threads.",
    category: "messaging",
    status: "not_configured",
    lastSyncAt: null,
    logo: "ST"
  },
  {
    id: "integration:mailchimp",
    name: "Mailchimp",
    description:
      "Broadcast newsletters and seasonal campaign blasts to project lists.",
    category: "messaging",
    status: "degraded",
    lastSyncAt: "2026-04-19T06:21:00.000Z",
    logo: "MC"
  },
  {
    id: "integration:notion",
    name: "Notion",
    description:
      "Internal knowledge base used as grounding context for AI-assisted replies.",
    category: "knowledge",
    status: "not_configured",
    lastSyncAt: null,
    logo: "N"
  },
  {
    id: "integration:openai",
    name: "OpenAI",
    description:
      "Drafting model that powers human-in-the-loop reply suggestions.",
    category: "ai",
    status: "connected",
    lastSyncAt: "2026-04-20T15:00:00.000Z",
    logo: "AI"
  }
];
