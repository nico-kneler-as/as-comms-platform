export type MergeToken =
  | "firstName"
  | "projectName"
  | "aliasEmail"
  | "viewInBrowser";

export interface AudienceMember {
  readonly contactId: string | null;
  readonly newsletterSubscriberId: string | null;
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
  readonly viewInBrowserUrl: string | null;
}

export type MissingTokensByContact = Readonly<Record<string, readonly string[]>>;
