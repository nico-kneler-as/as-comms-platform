import { InboxWelcomeWorkload } from "./_components/inbox-welcome-workload";
import { getInboxWelcomeWorkload } from "./_lib/selectors";

export default async function InboxListPage() {
  const workload = await getInboxWelcomeWorkload();

  return <InboxWelcomeWorkload workload={workload} />;
}
