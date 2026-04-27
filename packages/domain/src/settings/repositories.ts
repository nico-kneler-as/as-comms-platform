import type { IntegrationHealthRecord } from "@as-comms/contracts";

import type {
  ProjectAliasRecord,
  SettingsProjectRecord,
  UserRecord,
  UserRole
} from "./records.js";

export interface UsersRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  listAll(): Promise<readonly UserRecord[]>;
  updateRole(id: string, role: UserRole): Promise<UserRecord>;
  setDeactivated(id: string, deactivatedAt: Date | null): Promise<UserRecord>;
  upsert(record: UserRecord): Promise<UserRecord>;
}

export interface ProjectAliasesRepository {
  listAll(): Promise<readonly ProjectAliasRecord[]>;
  findById(id: string): Promise<ProjectAliasRecord | null>;
  findByAlias(alias: string): Promise<ProjectAliasRecord | null>;
  listAssigned(): Promise<readonly ProjectAliasRecord[]>;
  replaceForProject(input: {
    readonly projectId: string;
    readonly aliases: readonly string[];
    readonly actorId: string;
  }): Promise<readonly ProjectAliasRecord[]>;
  updateSignature(input: {
    readonly aliasId: string;
    readonly signature: string;
    readonly actorId: string;
  }): Promise<ProjectAliasRecord | null>;
  create(record: ProjectAliasRecord): Promise<ProjectAliasRecord>;
  update(record: ProjectAliasRecord): Promise<ProjectAliasRecord>;
  delete(id: string): Promise<void>;
}

export interface SettingsProjectsRepository {
  findById(projectId: string): Promise<SettingsProjectRecord | null>;
  listAll(): Promise<readonly SettingsProjectRecord[]>;
  setActive(
    projectId: string,
    isActive: boolean
  ): Promise<SettingsProjectRecord | null>;
  setAiKnowledgeUrl(
    projectId: string,
    aiKnowledgeUrl: string | null
  ): Promise<SettingsProjectRecord | null>;
  unlinkAiKnowledge(projectId: string): Promise<SettingsProjectRecord | null>;
  setProjectAlias(
    projectId: string,
    projectAlias: string | null
  ): Promise<SettingsProjectRecord | null>;
}

export interface IntegrationHealthRepository {
  findById(id: string): Promise<IntegrationHealthRecord | null>;
  listAll(): Promise<readonly IntegrationHealthRecord[]>;
  seedDefaults(): Promise<void>;
  upsert(record: IntegrationHealthRecord): Promise<IntegrationHealthRecord>;
}

export interface Stage2RepositoryBundle {
  readonly integrationHealth: IntegrationHealthRepository;
  readonly projects: SettingsProjectsRepository;
  readonly users: UsersRepository;
  readonly aliases: ProjectAliasesRepository;
}

export function defineStage2RepositoryBundle<T extends Stage2RepositoryBundle>(
  bundle: T
): T {
  return bundle;
}
