import type { IntegrationHealthRecord } from "@as-comms/contracts";
import type {
  ConsentRecordRepository,
  SmsMessageRepository,
  SmsSenderRepository
} from "../repositories.js";

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
  updateName(id: string, name: string): Promise<UserRecord>;
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

export interface SettingsProjectsConnectionResult {
  readonly host: SettingsProjectRecord;
  readonly connectedProjects: readonly SettingsProjectRecord[];
}

export interface SettingsProjectDeactivationResult {
  readonly project: SettingsProjectRecord;
  readonly cascadedSubProjects: readonly SettingsProjectRecord[];
}

export interface SettingsProjectsRepository {
  findById(projectId: string): Promise<SettingsProjectRecord | null>;
  listAll(): Promise<readonly SettingsProjectRecord[]>;
  setActive(
    projectId: string,
    isActive: boolean
  ): Promise<SettingsProjectRecord | null>;
  /**
   * Deactivates a host and cascades the change to all of its currently
   * connected sub-projects in a single transaction. Each cascaded sub-project
   * has its `is_active` flipped to false and `connected_to_project_id` set to
   * NULL. Use this whenever an admin deactivates a host so connected
   * sub-projects don't end up orphaned-yet-active.
   */
  deactivateWithCascade(
    projectId: string
  ): Promise<SettingsProjectDeactivationResult | null>;
  setAiKnowledgeUrl(
    projectId: string,
    aiKnowledgeUrl: string | null
  ): Promise<SettingsProjectRecord | null>;
  unlinkAiKnowledge(projectId: string): Promise<SettingsProjectRecord | null>;
  setProjectAlias(
    projectId: string,
    projectAlias: string | null
  ): Promise<SettingsProjectRecord | null>;
  /**
   * Returns active projects whose `connected_to_project_id` points at the
   * given host, ordered by name. Connected sub-projects roll into the host's
   * inbox and dashboard tile.
   */
  listConnectedProjects(
    hostProjectId: string
  ): Promise<readonly SettingsProjectRecord[]>;
  /**
   * Returns projects available to be picked as connection candidates: any
   * inactive row whose `connected_to_project_id` is NULL. Ordered by name.
   */
  listAvailableConnectionCandidates(): Promise<readonly SettingsProjectRecord[]>;
  /**
   * Connects the given inactive sub-projects to the host: flips them to
   * `is_active=true, connected_to_project_id=hostId, project_alias=NULL,
   * ai_knowledge_url=NULL` in a single transaction. Validates that the host
   * is active with a non-empty alias and that each sub is currently inactive
   * with no existing connection. Throws on validation failure.
   */
  connectProjectsToHost(input: {
    readonly hostProjectId: string;
    readonly connectedProjectIds: readonly string[];
  }): Promise<SettingsProjectsConnectionResult>;
  /**
   * Disconnects a connected sub-project: flips it to `is_active=false,
   * connected_to_project_id=NULL`. Leaves alias and AI knowledge URL as null
   * (already cleared at connect time). Throws if the project has no
   * connection.
   */
  disconnectProject(
    projectId: string
  ): Promise<SettingsProjectRecord | null>;
}

export interface IntegrationHealthRepository {
  findById(id: string): Promise<IntegrationHealthRecord | null>;
  listAll(): Promise<readonly IntegrationHealthRecord[]>;
  seedDefaults(): Promise<void>;
  upsert(record: IntegrationHealthRecord): Promise<IntegrationHealthRecord>;
}

export interface Stage2RepositoryBundle {
  readonly smsMessages: SmsMessageRepository;
  readonly consentRecords: ConsentRecordRepository;
  readonly smsSenders: SmsSenderRepository;
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
