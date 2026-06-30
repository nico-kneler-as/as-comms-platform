import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { broadcastMediaAssets } from "../src/index.js";
import {
  countMediaAssets,
  createMediaAsset,
  getMediaAssetById,
  listMediaAssets,
  softDeleteMediaAsset,
} from "../src/media-assets-repository.js";
import { createTestStage1Context, type TestStage1Context } from "./helpers.js";

function createUserRecord(id: string, email: string) {
  const now = new Date("2026-06-19T10:00:00.000Z");

  return {
    id,
    name: id,
    email,
    emailVerified: now,
    image: null,
    role: "operator" as const,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildMediaAssetInput(
  overrides: Partial<Parameters<typeof createMediaAsset>[1]> = {},
) {
  return {
    uploaderId: "user:one",
    storageKey: "broadcasts/hero.png",
    publicUrl: "https://cdn.example.org/broadcasts/hero.png",
    filename: "hero.png",
    contentType: "image/png",
    sizeBytes: 2048,
    ...overrides,
  };
}

describe("media assets repository", () => {
  let context: TestStage1Context;

  beforeEach(async () => {
    context = await createTestStage1Context();
    await context.settings.users.upsert(
      createUserRecord("user:one", "one@example.org"),
    );
  });

  afterEach(async () => {
    await context.dispose();
  });

  it("creates an asset and fetches it by id", async () => {
    const created = await createMediaAsset(context.db, buildMediaAssetInput());
    const fetched = await getMediaAssetById(context.db, created.id);

    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(fetched).toEqual(created);
  });

  it("lists newest-first and excludes soft-deleted assets", async () => {
    const older = await createMediaAsset(
      context.db,
      buildMediaAssetInput({
        storageKey: "broadcasts/older.png",
        publicUrl: "https://cdn.example.org/broadcasts/older.png",
        filename: "older.png",
      }),
    );
    const newer = await createMediaAsset(
      context.db,
      buildMediaAssetInput({
        storageKey: "broadcasts/newer.png",
        publicUrl: "https://cdn.example.org/broadcasts/newer.png",
        filename: "newer.png",
      }),
    );

    await context.db
      .update(broadcastMediaAssets)
      .set({ createdAt: new Date("2026-06-19T10:00:00.000Z") })
      .where(eq(broadcastMediaAssets.id, older.id));
    await context.db
      .update(broadcastMediaAssets)
      .set({ createdAt: new Date("2026-06-19T11:00:00.000Z") })
      .where(eq(broadcastMediaAssets.id, newer.id));

    await softDeleteMediaAsset(context.db, older.id);

    const listed = await listMediaAssets(context.db, {
      limit: 10,
      cursor: null,
    });

    expect(listed.items.map((asset) => asset.id)).toEqual([newer.id]);
    expect(listed.nextCursor).toBeNull();
  });

  it("soft-deletes from list but still returns the row by id", async () => {
    const created = await createMediaAsset(context.db, buildMediaAssetInput());

    await softDeleteMediaAsset(context.db, created.id);

    const listed = await listMediaAssets(context.db, {
      limit: 10,
      cursor: null,
    });
    const fetched = await getMediaAssetById(context.db, created.id);

    expect(listed.items).toHaveLength(0);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.deletedAt).not.toBeNull();
    expect(typeof fetched?.deletedAt).toBe("string");
  });

  it("counts only non-deleted assets", async () => {
    await createMediaAsset(
      context.db,
      buildMediaAssetInput({
        storageKey: "broadcasts/first.png",
        publicUrl: "https://cdn.example.org/broadcasts/first.png",
        filename: "first.png",
      }),
    );
    const deleted = await createMediaAsset(
      context.db,
      buildMediaAssetInput({
        storageKey: "broadcasts/deleted.png",
        publicUrl: "https://cdn.example.org/broadcasts/deleted.png",
        filename: "deleted.png",
      }),
    );
    await createMediaAsset(
      context.db,
      buildMediaAssetInput({
        storageKey: "broadcasts/last.png",
        publicUrl: "https://cdn.example.org/broadcasts/last.png",
        filename: "last.png",
      }),
    );

    await softDeleteMediaAsset(context.db, deleted.id);

    await expect(countMediaAssets(context.db)).resolves.toBe(2);
  });
});
