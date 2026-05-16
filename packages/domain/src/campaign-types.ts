export type MergeToken = "firstName" | "projectName" | "aliasEmail";

export interface AudienceMember {
  readonly contactId: string;
  readonly frozenEmail: string;
  readonly frozenFirstName: string | null;
  readonly frozenProjectName: string | null;
  readonly frozenProjectId: string | null;
  readonly frozenAliasEmail: string | null;
}

export interface ExcludedMember extends AudienceMember {
  readonly reason:
    | "suppressed"
    | "opted_out_project"
    | "opted_out_newsletter"
    | "opted_out_all";
}

export interface MergeContext {
  readonly firstName: string | null;
  readonly projectName: string | null;
  readonly aliasEmail: string | null;
}

export type MissingTokensByContact = Readonly<Record<string, readonly string[]>>;
