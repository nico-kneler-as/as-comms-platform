import { requireSession } from "@/src/server/auth/session";

import { AllContactsView } from "../_components/all-contacts-view";

export const metadata = {
  title: "All contacts · Inbox",
};

interface PageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /inbox/all-contacts — search-only view that bypasses
 * `contact_inbox_projection` and queries `contacts` directly so
 * volunteer-support operators can find any volunteer in the database, even
 * those with only signup/lifecycle events or no events at all.
 */
export default async function AllContactsPage({ searchParams }: PageProps) {
  await requireSession();
  const params = (await searchParams) ?? {};
  const rawQuery = params.q;
  const initialQuery = Array.isArray(rawQuery) ? (rawQuery[0] ?? "") : (rawQuery ?? "");

  return <AllContactsView initialQuery={initialQuery} />;
}
