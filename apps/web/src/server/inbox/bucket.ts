import type { InboxBucket } from "@as-comms/contracts";

import { getStage1WebRuntime } from "../stage1-runtime";

export interface InboxBucketUpdateResult {
  readonly ok: true;
  readonly contactId: string;
  readonly bucket: InboxBucket;
}

export interface InboxBucketUpdateNotFound {
  readonly ok: false;
  readonly code: "inbox_contact_not_found";
}

export async function setInboxBucket(input: {
  readonly contactId: string;
  readonly bucket: InboxBucket;
}): Promise<InboxBucketUpdateResult | InboxBucketUpdateNotFound> {
  const runtime = await getStage1WebRuntime();
  const updated = await runtime.repositories.inboxProjection.setBucket({
    contactId: input.contactId,
    bucket: input.bucket,
  });

  if (updated === null) {
    return {
      ok: false,
      code: "inbox_contact_not_found",
    };
  }

  return {
    ok: true,
    contactId: input.contactId,
    bucket: input.bucket,
  };
}
