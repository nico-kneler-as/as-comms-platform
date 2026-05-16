import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

import { MegaphoneIcon } from "../inbox/_components/icons";

export default function CampaignsPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="border-b border-slate-200 bg-white px-8 py-8">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
          <div>
            <h1 className="text-balance text-2xl font-semibold text-slate-900">
              Campaigns
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-slate-500">
              The run history and Mailchimp read-side land in Brief A8. This route
              is scaffolded now so the create wizard has a native Campaigns home.
            </p>
          </div>
          <Button asChild>
            <Link href="/campaigns/new">New campaign</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-1 px-8 py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-1 rounded-3xl border border-slate-200 bg-white">
          <EmptyState
            size="lg"
            icon={<MegaphoneIcon className="size-7 text-slate-500" />}
            title="No campaigns yet"
            description="Create the first in-app campaign draft. Historical Mailchimp and native campaign rows will populate here once the read-side lands."
            action={
              <Button asChild>
                <Link href="/campaigns/new">New campaign</Link>
              </Button>
            }
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}
