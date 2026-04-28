export const GOOGLE_WORKSPACE_DOMAIN = "adventurescientists.org";

const GOOGLE_WORKSPACE_EMAIL_SUFFIX = `@${GOOGLE_WORKSPACE_DOMAIN}`;

interface GoogleSignInUserRecord {
  readonly deactivatedAt: Date | null;
}

export function hasAuthorizedGoogleWorkspaceEmail(
  email: string | null | undefined
): boolean {
  return (
    typeof email === "string" &&
    email.toLowerCase().endsWith(GOOGLE_WORKSPACE_EMAIL_SUFFIX)
  );
}

export function canSignInWithGoogle(input: {
  readonly email: string | null | undefined;
  readonly userRecord: GoogleSignInUserRecord | null;
}): boolean {
  if (!hasAuthorizedGoogleWorkspaceEmail(input.email)) {
    return false;
  }

  return input.userRecord !== null && input.userRecord.deactivatedAt === null;
}
