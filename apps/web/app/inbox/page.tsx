import { requireSession } from "@/src/server/auth/session";

import { InboxWelcomeWorkload } from "./_components/inbox-welcome-workload";
import { getInboxWelcomeWorkload } from "./_lib/selectors";

export default async function InboxListPage() {
  const [workload, currentUser] = await Promise.all([
    getInboxWelcomeWorkload(),
    requireSession(),
  ]);

  const displayName = currentUser.name ?? currentUser.email;
  const firstName = displayName.trim().split(/\s+/)[0] ?? "there";

  return <InboxWelcomeWorkload workload={workload} firstName={firstName} />;
}
