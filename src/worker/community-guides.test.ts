import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidateCommunityGuides,
  publishedGuideHashes,
  resetCommunityGuidesCacheForTests,
} from "./community-guides";

const bucketWith = (keys: string[]) =>
  ({
    list: vi.fn(async () => ({
      objects: keys.map((key) => ({ key })),
      truncated: false,
    })),
  }) as unknown as R2Bucket;

beforeEach(() => {
  resetCommunityGuidesCacheForTests();
});

describe("publishedGuideHashes", () => {
  it("cachea las guías publicadas y las vuelve a listar tras invalidar", async () => {
    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);
    const bucket = bucketWith([
      `guides/${hashA}.json`,
      `guides/${hashB}.txt`,
      "guides/no-es-hash.json",
    ]);

    const first = await publishedGuideHashes(bucket);
    expect(first?.has(hashA)).toBe(true);
    expect(first?.has(hashB)).toBe(false);
    expect(bucket.list).toHaveBeenCalledTimes(1);

    const second = await publishedGuideHashes(bucket);
    expect(second).toBe(first);
    expect(bucket.list).toHaveBeenCalledTimes(1);

    invalidateCommunityGuides();
    await publishedGuideHashes(bucket);
    expect(bucket.list).toHaveBeenCalledTimes(2);
  });

  it("sin bucket o con R2 caído devuelve null sin cachear el fallo", async () => {
    expect(await publishedGuideHashes(undefined)).toBeNull();

    const failing = {
      list: vi.fn(async () => {
        throw new Error("r2 down");
      }),
    } as unknown as R2Bucket;
    expect(await publishedGuideHashes(failing)).toBeNull();
    expect(await publishedGuideHashes(failing)).toBeNull();
    expect(failing.list).toHaveBeenCalledTimes(2);

    const bucket = bucketWith([`guides/${"c".repeat(64)}.json`]);
    expect(await publishedGuideHashes(bucket)).not.toBeNull();
  });
});
