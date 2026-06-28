import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { createObjectStoreClient } from "../src/providers/object-store.js";

function createFakeSend() {
  return vi.fn((command: unknown) => {
    void command;
    return Promise.resolve({});
  });
}

describe("object-store provider", () => {
  it("uploads bytes with the expected bucket, key, and content type", async () => {
    const send = createFakeSend();
    const client = createObjectStoreClient(
      {
        accountId: "acct-123",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        bucket: "broadcast-assets",
        publicBaseUrl: "https://cdn.example.org/assets/",
      },
      { send },
    );

    const result = await client.putObject({
      key: "images/test-image.png",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls.at(0)?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    if (!(command instanceof PutObjectCommand)) {
      throw new Error("Expected a PutObjectCommand.");
    }
    expect(command.input).toMatchObject({
      Bucket: "broadcast-assets",
      Key: "images/test-image.png",
      Body: new Uint8Array([1, 2, 3]),
      ContentType: "image/png",
    });
    expect(result).toEqual({
      url: "https://cdn.example.org/assets/images/test-image.png",
    });
  });

  it("builds public URLs from the configured base URL", () => {
    const client = createObjectStoreClient(
      {
        accountId: "acct-123",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        bucket: "broadcast-assets",
        publicBaseUrl: "https://cdn.example.org/assets",
      },
      { send: createFakeSend() },
    );

    expect(client.publicUrl("images/example.webp")).toBe(
      "https://cdn.example.org/assets/images/example.webp",
    );
  });

  it("deletes objects from the configured bucket", async () => {
    const send = createFakeSend();
    const client = createObjectStoreClient(
      {
        accountId: "acct-123",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        bucket: "broadcast-assets",
        publicBaseUrl: "https://cdn.example.org/assets",
      },
      { send },
    );

    await client.deleteObject("images/obsolete.gif");

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls.at(0)?.[0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    if (!(command instanceof DeleteObjectCommand)) {
      throw new Error("Expected a DeleteObjectCommand.");
    }
    expect(command.input).toMatchObject({
      Bucket: "broadcast-assets",
      Key: "images/obsolete.gif",
    });
  });
});
