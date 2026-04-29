import { unstable_cache } from "next/cache";

import type {
  IntegrationHealthCategory,
  IntegrationHealthStatus
} from "@as-comms/contracts";

import { getCurrentUser } from "../auth/session";
import { recordSensitiveReadForCurrentUserDetached } from "../security/audit";
import { getStage1WebRuntime } from "../stage1-runtime";

export interface ProjectRowViewModel {
  readonly projectId: string;
  readonly projectName: string;
  readonly suggestedAlias: string;
  readonly projectAlias: string | null;
  readonly isActive: boolean;
  readonly primaryEmail: string | null;
  readonly emailAliases: readonly string[];
  readonly additionalEmailCount: number;
  readonly aiKnowledgeUrl: string | null;
  readonly aiKnowledgeSyncedAt: string | null;
  readonly hasCachedAiKnowledge: boolean;
  readonly memberCount: number;
  readonly activationRequirementsMet: boolean;
}

export interface ProjectsSettingsViewModel {
  readonly isAdmin: boolean;
  readonly active: readonly ProjectRowViewModel[];
  readonly inactive: readonly ProjectRowViewModel[];
  readonly counts: {
    readonly active: number;
    readonly inactive: number;
    readonly total: number;
  };
}

export interface ProjectSettingsDetailViewModel extends ProjectRowViewModel {
  readonly isAdmin: boolean;
  readonly emails: readonly {
    readonly id: string;
    readonly address: string;
    readonly isPrimary: boolean;
    readonly signature: string;
  }[];
  readonly salesforceProjectId: string | null;
}

export interface UserRowViewModel {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: "admin" | "internal_user";
  readonly lastActiveAt: string | null;
  readonly status: "active" | "pending" | "deactivated";
}

export interface AccessSettingsViewModel {
  readonly isAdmin: boolean;
  readonly currentUserId: string | null;
  readonly admins: readonly UserRowViewModel[];
  readonly internalUsers: readonly UserRowViewModel[];
}

export interface IntegrationHealthViewModel {
  readonly serviceName: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: IntegrationHealthCategory;
  readonly status: IntegrationHealthStatus;
  readonly lastCheckedAt: string | null;
  readonly detail: string | null;
  readonly supportsRefresh: boolean;
}

export interface IntegrationsSettingsViewModel {
  readonly isAdmin: boolean;
  readonly integrations: readonly IntegrationHealthViewModel[];
}

const INTEGRATION_ORDER = [
  "salesforce",
  "gmail",
  "simpletexting",
  "mailchimp",
  "notion",
  "openai"
] as const;

const INTEGRATION_META = {
  salesforce: {
    displayName: "Salesforce",
    description: "Contacts and project records",
    supportsRefresh: true
  },
  gmail: {
    displayName: "Gmail",
    description: "Inbound and outbound email",
    supportsRefresh: true
  },
  simpletexting: {
    displayName: "SimpleTexting",
    description: "Volunteer SMS delivery",
    supportsRefresh: false
  },
  mailchimp: {
    displayName: "Mailchimp",
    description: "Historical campaign records",
    supportsRefresh: false
  },
  notion: {
    displayName: "Notion",
    description: "Knowledge sync source",
    supportsRefresh: false
  },
  openai: {
    displayName: "Anthropic",
    description: "AI draft provider",
    supportsRefresh: false
  }
} as const satisfies Record<
  (typeof INTEGRATION_ORDER)[number],
  {
    readonly displayName: string;
    readonly description: string;
    readonly supportsRefresh: boolean;
  }
>;

function normalizeSearch(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed.toLowerCase();
}

function hasActivationRequirements(input: {
  readonly projectAlias: string | null;
  readonly hasCachedAiKnowledge: boolean;
  readonly emailCount: number;
}): boolean {
  return (
    input.emailCount >= 1 &&
    input.hasCachedAiKnowledge &&
    (input.projectAlias?.trim().length ?? 0) > 0
  );
}

function deriveSuggestedAlias(projectName: string): string {
  const collapsedName = projectName.trim().replace(/\s+/g, " ");
  const afterColon = collapsedName.includes(":")
    ? collapsedName.slice(collapsedName.lastIndexOf(":") + 1).trim()
    : collapsedName;
  const withoutCommonPrefix = afterColon.replace(
    /^(WPEF|Searching For|Restoring)\s+/i,
    ""
  );
  const meaningfulWords = withoutCommonPrefix
    .split(" ")
    .filter((word) => word.length > 0)
    .slice(0, 3)
    .join(" ")
    .trim();
  const fallback = withoutCommonPrefix.trim().slice(0, 32);
  const candidate = meaningfulWords.length > 0 ? meaningfulWords : fallback;

  if (candidate.length === 0) {
    return collapsedName.slice(0, 32);
  }

  return candidate.slice(0, 32);
}

function toProjectRowViewModel(input: {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectAlias: string | null;
  readonly isActive: boolean;
  readonly aiKnowledgeUrl: string | null;
  readonly aiKnowledgeSyncedAt: Date | null;
  readonly hasCachedAiKnowledge: boolean;
  readonly emails: readonly {
    readonly id: string;
    readonly address: string;
    readonly isPrimary: boolean;
    readonly signature: string;
  }[];
  readonly memberCount: number;
}): ProjectRowViewModel {
  const primaryEmail =
    input.emails.find((email) => email.isPrimary)?.address ?? null;
  const additionalEmailCount = Math.max(input.emails.length - 1, 0);

  return {
    projectId: input.projectId,
    projectName: input.projectName,
    suggestedAlias: deriveSuggestedAlias(input.projectName),
    projectAlias: input.projectAlias,
    isActive: input.isActive,
    primaryEmail,
    emailAliases: input.emails.map((email) => email.address),
    additionalEmailCount,
    aiKnowledgeUrl: input.aiKnowledgeUrl,
    aiKnowledgeSyncedAt: input.aiKnowledgeSyncedAt?.toISOString() ?? null,
    hasCachedAiKnowledge: input.hasCachedAiKnowledge,
    memberCount: input.memberCount,
    activationRequirementsMet: hasActivationRequirements({
      projectAlias: input.projectAlias,
      hasCachedAiKnowledge: input.hasCachedAiKnowledge,
      emailCount: input.emails.length
    })
  };
}

async function readProjectsSettings(input: {
  readonly filter: "active" | "inactive" | "all";
  readonly search?: string | null;
}): Promise<Omit<ProjectsSettingsViewModel, "isAdmin">> {
  const runtime = await getStage1WebRuntime();
  const normalizedSearch = normalizeSearch(input.search);
  const projects = await runtime.settings.projects.listAll();

  const matchingProjects = projects.filter((project) => {
    if (normalizedSearch === null) {
      return true;
    }

    return (
      project.projectName.toLowerCase().includes(normalizedSearch) ||
      (project.projectAlias?.toLowerCase().includes(normalizedSearch) ?? false) ||
      project.emails.some((email) =>
        email.address.toLowerCase().includes(normalizedSearch)
      )
    );
  });

  const filteredProjects = matchingProjects.filter((project) => {
    if (input.filter === "all") {
      return true;
    }

    return input.filter === "active" ? project.isActive : !project.isActive;
  });

  const active = filteredProjects
    .filter((project) => project.isActive)
    .sort(
      (left, right) =>
        right.updatedAt.getTime() - left.updatedAt.getTime() ||
        left.projectName.localeCompare(right.projectName)
    )
    .map(toProjectRowViewModel);
  const inactive = filteredProjects
    .filter((project) => !project.isActive)
    .sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        left.projectName.localeCompare(right.projectName)
    )
    .map(toProjectRowViewModel);

  return {
    active,
    inactive,
    counts: {
      active: active.length,
      inactive: inactive.length,
      total: active.length + inactive.length
    }
  };
}

async function readProjectSettingsDetail(
  projectId: string
) {
  const runtime = await getStage1WebRuntime();
  const project = await runtime.settings.projects.findById(projectId);

  if (project === null) {
    return null;
  }

  return {
    ...toProjectRowViewModel(project),
    emails: project.emails,
    salesforceProjectId: project.salesforceProjectId
  };
}

function toUserViewModel(user: {
  readonly id: string;
  readonly name: string | null;
  readonly email: string;
  readonly role: "admin" | "operator";
  readonly emailVerified: Date | null;
  readonly deactivatedAt: Date | null;
  readonly updatedAt: Date;
}): UserRowViewModel {
  const status =
    user.deactivatedAt !== null
      ? "deactivated"
      : user.emailVerified === null
        ? "pending"
        : "active";

  return {
    userId: user.id,
    displayName: user.name ?? user.email,
    email: user.email,
    role: user.role === "admin" ? "admin" : "internal_user",
    lastActiveAt:
      status === "pending"
        ? null
        : (user.deactivatedAt ?? user.updatedAt).toISOString(),
    status
  };
}

function sortUsers(
  users: readonly UserRowViewModel[],
  currentUserId: string | null
): UserRowViewModel[] {
  const statusRank = {
    active: 0,
    pending: 1,
    deactivated: 2
  } as const;

  return users.slice().sort((left, right) => {
    if (left.userId === currentUserId) {
      return -1;
    }
    if (right.userId === currentUserId) {
      return 1;
    }

    const statusDelta = statusRank[left.status] - statusRank[right.status];
    if (statusDelta !== 0) {
      return statusDelta;
    }

    return left.displayName.localeCompare(right.displayName);
  });
}

async function readAccessSettings() {
  const runtime = await getStage1WebRuntime();
  const users = await runtime.settings.users.listAll();
  const rows = users.map(toUserViewModel);
  return {
    rows
  };
}

async function readIntegrationHealth() {
  const runtime = await getStage1WebRuntime();

  await runtime.settings.integrationHealth.seedDefaults();
  const rows = await runtime.settings.integrationHealth.listAll();

  const integrationById = new Map(rows.map((row) => [row.id, row] as const));
  const integrations = INTEGRATION_ORDER.flatMap((serviceName) => {
    const record = integrationById.get(serviceName);
    if (record === undefined) {
      return [];
    }

    const meta = INTEGRATION_META[serviceName];
    return [
      {
        serviceName: record.serviceName,
        displayName: meta.displayName,
        description: meta.description,
        category: record.category,
        status: record.status,
        lastCheckedAt: record.lastCheckedAt,
        detail: record.detail,
        supportsRefresh: meta.supportsRefresh
      }
    ];
  });

  return {
    integrations
  };
}

function loadProjectsSettingsCacheData(input: {
  readonly filter: "active" | "inactive" | "all";
  readonly search?: string | null;
}) {
  if (process.env.NODE_ENV !== "production") {
    return readProjectsSettings(input);
  }

  return unstable_cache(
    () => readProjectsSettings(input),
    [
      `settings:projects:${input.filter}:${normalizeSearch(input.search) ?? "none"}`
    ],
    {
      tags: ["settings:projects"]
    }
  )();
}

function loadProjectSettingsDetailCacheData(projectId: string) {
  if (process.env.NODE_ENV !== "production") {
    return readProjectSettingsDetail(projectId);
  }

  return unstable_cache(
    () => readProjectSettingsDetail(projectId),
    [`settings:project:${projectId}`],
    {
      tags: ["settings:projects", `settings:projects:${projectId}`]
    }
  )();
}

function loadAccessSettingsCacheData() {
  if (process.env.NODE_ENV !== "production") {
    return readAccessSettings();
  }

  return unstable_cache(() => readAccessSettings(), ["settings:access"], {
    tags: ["settings:access"]
  })();
}

function loadIntegrationHealthCacheData() {
  if (process.env.NODE_ENV !== "production") {
    return readIntegrationHealth();
  }

  return unstable_cache(
    () => readIntegrationHealth(),
    ["settings:integrations"],
    {
      tags: ["settings:integrations"]
    }
  )();
}

export async function loadProjectsSettings(input: {
  readonly filter: "active" | "inactive" | "all";
  readonly search?: string | null;
}): Promise<ProjectsSettingsViewModel> {
  const [currentUser, cachedData] = await Promise.all([
    getCurrentUser(),
    loadProjectsSettingsCacheData(input)
  ]);
  const normalizedSearch = normalizeSearch(input.search);

  recordSensitiveReadForCurrentUserDetached({
    action: "settings.projects.read",
    entityType: "settings_page",
    entityId: "projects",
    metadataJson: {
      filter: input.filter,
      visibleProjectCount: cachedData.counts.total,
      search: normalizedSearch
    }
  });

  return {
    isAdmin: currentUser?.role === "admin",
    ...cachedData
  };
}

export async function loadProjectSettingsDetail(
  projectId: string
): Promise<ProjectSettingsDetailViewModel | null> {
  const [currentUser, cachedData] = await Promise.all([
    getCurrentUser(),
    loadProjectSettingsDetailCacheData(projectId)
  ]);

  if (cachedData === null) {
    return null;
  }

  recordSensitiveReadForCurrentUserDetached({
    action: "settings.project.read",
    entityType: "project",
    entityId: projectId,
    metadataJson: {
      emailCount: cachedData.emails.length
    }
  });

  return {
    ...cachedData,
    isAdmin: currentUser?.role === "admin"
  };
}

export async function loadAccessSettings(): Promise<AccessSettingsViewModel> {
  const currentUser = await getCurrentUser();
  if (currentUser === null) {
    throw new Error("UNAUTHORIZED");
  }
  if (currentUser.role !== "admin") {
    throw new Error("FORBIDDEN");
  }

  const cachedData = await loadAccessSettingsCacheData();
  const currentUserId = currentUser.id;
  const admins = sortUsers(
    cachedData.rows.filter((user) => user.role === "admin"),
    currentUserId
  );
  const internalUsers = sortUsers(
    cachedData.rows.filter((user) => user.role === "internal_user"),
    currentUserId
  );

  recordSensitiveReadForCurrentUserDetached({
    action: "settings.users.read",
    entityType: "settings_page",
    entityId: "users",
    metadataJson: {
      visibleUserCount: cachedData.rows.length
    }
  });

  return {
    isAdmin: true,
    currentUserId,
    admins,
    internalUsers
  };
}

export async function loadIntegrationHealth(): Promise<IntegrationsSettingsViewModel> {
  const [currentUser, cachedData] = await Promise.all([
    getCurrentUser(),
    loadIntegrationHealthCacheData()
  ]);

  recordSensitiveReadForCurrentUserDetached({
    action: "settings.integrations.read",
    entityType: "settings_page",
    entityId: "integrations",
    metadataJson: {
      visibleIntegrationCount: cachedData.integrations.length
    }
  });

  return {
    isAdmin: currentUser?.role === "admin",
    integrations: cachedData.integrations
  };
}
