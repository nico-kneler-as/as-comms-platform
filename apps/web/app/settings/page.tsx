import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The redesigned `/settings` surface has three sub-routes. `/settings` with
 * nothing after it redirects to Active Projects so the section nav always
 * has an active row.
 */
export default function SettingsIndexPage(): never {
  redirect("/settings/projects");
}
