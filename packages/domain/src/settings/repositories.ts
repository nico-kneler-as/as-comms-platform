import type {
  ProjectAliasRecord,
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
  create(record: ProjectAliasRecord): Promise<ProjectAliasRecord>;
  update(record: ProjectAliasRecord): Promise<ProjectAliasRecord>;
  delete(id: string): Promise<void>;
}

export interface Stage2RepositoryBundle {
  readonly users: UsersRepository;
  readonly aliases: ProjectAliasesRepository;
}

export function defineStage2RepositoryBundle<T extends Stage2RepositoryBundle>(
  bundle: T
): T {
  return bundle;
}
