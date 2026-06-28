import { createObjectStoreClient } from "@as-comms/integrations";
import { z } from "zod";

const objectStoreConfigSchema = z.object({
  accountId: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  bucket: z.string().min(1),
  publicBaseUrl: z.string().url().min(1),
});

function readObjectStoreConfig(env: NodeJS.ProcessEnv = process.env) {
  return objectStoreConfigSchema.parse({
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    publicBaseUrl: env.R2_PUBLIC_BASE_URL,
  });
}

export async function uploadBroadcastImageToObjectStore(input: {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
}): Promise<{ readonly url: string }> {
  const config = readObjectStoreConfig();
  const client = createObjectStoreClient(config);

  return client.putObject({
    key: input.key,
    bytes: input.bytes,
    contentType: input.contentType,
  });
}
