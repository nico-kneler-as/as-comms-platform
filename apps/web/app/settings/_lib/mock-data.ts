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
  /** Short slug used across the platform (e.g. `killer-whales`). */
  readonly alias: string;
  /** Inbound email address routed to this project's inbox. */
  readonly inboxAlias: string;
  /** Every email address routed to the project. Most have one; some have two. */
  readonly emails: readonly string[];
  readonly active: boolean;
}

/**
 * Non-active Salesforce projects surfaced in the "Activate new project"
 * dialog. Stored with the same shape as {@link MockProject} plus a
 * `lastActiveAt` ISO timestamp and a short description so the dialog row has
 * something meaningful to show.
 */
export interface MockInactiveProject {
  readonly id: string;
  readonly name: string;
  readonly alias: string;
  readonly inboxAlias: string;
  readonly description: string;
  readonly lastActiveAt: string | null;
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
    alias: "killer-whales",
    inboxAlias: "killer-whales@asc.internal",
    emails: ["killer-whales@asc.internal"],
    active: true
  },
  {
    id: "project:coral-reefs",
    name: "Monitoring Coral Reefs",
    alias: "coral-reefs",
    inboxAlias: "coral-reefs@asc.internal",
    // One of the multi-email paths — exercises add/remove on the detail page.
    emails: ["coral-reefs@asc.internal", "reef-support@asc.internal"],
    active: true
  },
  {
    id: "project:butternut-beech",
    name: "Butternut and Beech",
    alias: "butternut-beech",
    inboxAlias: "butternut-beech@asc.internal",
    emails: ["butternut-beech@asc.internal"],
    active: true
  },
  {
    id: "project:pnw-forest-biodiversity",
    name: "PNW Forest Biodiversity",
    alias: "pnw-forest",
    inboxAlias: "pnw-forest@asc.internal",
    emails: ["pnw-forest@asc.internal"],
    active: false
  }
];

/**
 * Non-active Salesforce projects that show up in the "Activate New Project"
 * dialog.
 *
 * TODO(stage2): default result set comes from cached Salesforce projects in
 * our DB — no Salesforce ping needed. Wire to the real non-active projects
 * query when persistence lands.
 */
export const MOCK_INACTIVE_PROJECTS: readonly MockInactiveProject[] = [
  {
    id: "sf-project:yellowstone-wolves",
    name: "Yellowstone Wolves",
    alias: "yellowstone-wolves",
    inboxAlias: "yellowstone-wolves@asc.internal",
    description: "Pack surveys in the greater Yellowstone ecosystem.",
    lastActiveAt: "2025-10-14T00:00:00.000Z"
  },
  {
    id: "sf-project:amazon-canopy-soundscapes",
    name: "Amazon Canopy Soundscapes",
    alias: "amazon-canopy",
    inboxAlias: "amazon-canopy@asc.internal",
    description: "Bioacoustic recordings from upper-canopy research stations.",
    lastActiveAt: "2025-08-02T00:00:00.000Z"
  },
  {
    id: "sf-project:arctic-seabird-counts",
    name: "Arctic Seabird Counts",
    alias: "arctic-seabirds",
    inboxAlias: "arctic-seabirds@asc.internal",
    description: "Breeding-season colony counts across circumpolar cliffs.",
    lastActiveAt: "2024-06-20T00:00:00.000Z"
  },
  {
    id: "sf-project:california-tide-pools",
    name: "California Tide Pools",
    alias: "ca-tide-pools",
    inboxAlias: "ca-tide-pools@asc.internal",
    description: "Intertidal biodiversity monitoring along the Pacific coast.",
    lastActiveAt: "2025-11-30T00:00:00.000Z"
  },
  {
    id: "sf-project:montana-wildfire-regrowth",
    name: "Montana Wildfire Regrowth",
    alias: "mt-regrowth",
    inboxAlias: "mt-regrowth@asc.internal",
    description: "Post-burn vegetation recovery transects in Rocky Mountain plots.",
    lastActiveAt: null
  },
  {
    id: "sf-project:nepal-glacier-retreat",
    name: "Nepal Glacier Retreat",
    alias: "nepal-glaciers",
    inboxAlias: "nepal-glaciers@asc.internal",
    description: "Photo-point resurvey of high-altitude ice fronts in the Khumbu.",
    lastActiveAt: "2023-05-09T00:00:00.000Z"
  },
  {
    id: "sf-project:patagonia-pumas",
    name: "Patagonia Pumas",
    alias: "patagonia-pumas",
    inboxAlias: "patagonia-pumas@asc.internal",
    description: "Track, scat, and camera-trap sampling across estancia corridors.",
    lastActiveAt: "2025-03-17T00:00:00.000Z"
  },
  {
    id: "sf-project:sierra-snowpack",
    name: "Sierra Snowpack",
    alias: "sierra-snow",
    inboxAlias: "sierra-snow@asc.internal",
    description: "Volunteer-collected SWE samples for watershed forecasting.",
    lastActiveAt: "2025-12-08T00:00:00.000Z"
  },
  {
    id: "sf-project:appalachian-salamanders",
    name: "Appalachian Salamanders",
    alias: "appalachian-sallies",
    inboxAlias: "appalachian-sallies@asc.internal",
    description: "Stream-side plethodon surveys for chytrid surveillance.",
    lastActiveAt: null
  },
  {
    id: "sf-project:great-plains-pollinators",
    name: "Great Plains Pollinators",
    alias: "plains-pollinators",
    inboxAlias: "plains-pollinators@asc.internal",
    description: "Native bee transect counts across restored prairie fragments.",
    lastActiveAt: "2024-09-21T00:00:00.000Z"
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

/** Look up a single project by id; returns `null` when the id is unknown. */
export function findMockProjectById(id: string): MockProject | null {
  return MOCK_PROJECTS.find((project) => project.id === id) ?? null;
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
