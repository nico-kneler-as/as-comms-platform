import path from "node:path";

import { z } from "zod";

export const attachmentServerConfigSchema = z.object({
  attachmentVolumePath: z.string().min(1),
});
export type AttachmentServerConfig = z.infer<
  typeof attachmentServerConfigSchema
>;

export function readAttachmentServerConfig(
  env: NodeJS.ProcessEnv,
): AttachmentServerConfig {
  return attachmentServerConfigSchema.parse({
    attachmentVolumePath: path.resolve(
      env.ATTACHMENT_VOLUME_PATH ??
        (env.NODE_ENV === "production"
          ? "/data/attachments"
          : "./tmp/attachments"),
    ),
  });
}
