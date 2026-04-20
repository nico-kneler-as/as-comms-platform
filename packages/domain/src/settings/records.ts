export type UserRole = "admin" | "operator";

export interface UserRecord {
  readonly id: string;
  readonly name: string | null;
  readonly email: string;
  readonly emailVerified: Date | null;
  readonly image: string | null;
  readonly role: UserRole;
  readonly deactivatedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProjectAliasRecord {
  readonly id: string;
  readonly alias: string;
  readonly projectId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly createdBy: string | null;
  readonly updatedBy: string | null;
}

export interface SettingsProjectEmailRecord {
  readonly address: string;
  readonly isPrimary: boolean;
}

export interface SettingsProjectRecord {
  readonly projectId: string;
  readonly salesforceProjectId: string | null;
  readonly projectName: string;
  readonly isActive: boolean;
  readonly aiKnowledgeUrl: string | null;
  readonly aiKnowledgeSyncedAt: Date | null;
  readonly emails: readonly SettingsProjectEmailRecord[];
  readonly memberCount: number;
  readonly updatedAt: Date;
}
