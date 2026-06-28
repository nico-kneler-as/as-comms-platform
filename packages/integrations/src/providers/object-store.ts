import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface ObjectStoreClientConfig {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly publicBaseUrl: string;
}

export interface ObjectStorePutObjectInput {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

interface S3ClientLike {
  send(command: PutObjectCommand | DeleteObjectCommand): Promise<unknown>;
}

export interface ObjectStoreClient {
  putObject(input: ObjectStorePutObjectInput): Promise<{ readonly url: string }>;
  publicUrl(key: string): string;
  deleteObject(key: string): Promise<void>;
}

function normalizePublicBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function createDefaultS3Client(config: ObjectStoreClientConfig): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function createObjectStoreClient(
  config: ObjectStoreClientConfig,
  client: S3ClientLike = createDefaultS3Client(config),
): ObjectStoreClient {
  const publicBaseUrl = normalizePublicBaseUrl(config.publicBaseUrl);

  return {
    async putObject(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: input.key,
          Body: input.bytes,
          ContentType: input.contentType,
        }),
      );

      return {
        url: `${publicBaseUrl}/${input.key}`,
      };
    },

    publicUrl(key) {
      return `${publicBaseUrl}/${key}`;
    },

    async deleteObject(key) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
      );
    },
  };
}
