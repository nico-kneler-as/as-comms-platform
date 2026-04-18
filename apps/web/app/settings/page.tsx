import { redirect } from "next/navigation";

/**
 * `/settings` has no dedicated landing view — deep-link operators straight
 * into Project Aliases (the default first-slice surface). Admin-only tabs are
 * gated in their own pages, so pointing operators here is safe.
 */
export default function SettingsPage() {
  redirect("/settings/aliases");
}
