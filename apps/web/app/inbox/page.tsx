import { requireSession } from "@/src/server/auth/session";

import { InboxWelcomeWorkload } from "./_components/inbox-welcome-workload";
import { getInboxWelcomeWorkload } from "./_lib/selectors";

function deriveFirstName(name: string | null, email: string): string {
  // Prefer the user's display name's first whitespace-delimited token.
  if (name !== null) {
    const trimmed = name.trim();
    if (trimmed.length > 0) {
      const token = trimmed.split(/\s+/u)[0] ?? "";
      if (token.length > 0) {
        return token;
      }
    }
  }

  // Fall back to the email's local part, capitalized — e.g.
  // "nico@adventurescientists.org" → "Nico". Reading "Welcome back,
  // nico@adventurescientists.org" looks like an error to operators.
  const local = (email.split("@")[0] ?? "").trim();
  if (local.length === 0) {
    return "there";
  }
  // Strip dots/dashes/underscores so first.last → "First".
  const cleanedToken = local.split(/[.\-_]+/u)[0] ?? local;
  if (cleanedToken.length === 0) {
    return "there";
  }
  return cleanedToken.charAt(0).toUpperCase() + cleanedToken.slice(1);
}

export default async function InboxListPage() {
  const [workload, currentUser] = await Promise.all([
    getInboxWelcomeWorkload(),
    requireSession(),
  ]);

  const firstName = deriveFirstName(currentUser.name, currentUser.email);

  return <InboxWelcomeWorkload workload={workload} firstName={firstName} />;
}
