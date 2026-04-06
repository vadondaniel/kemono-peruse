import {
  collectCachedPosts,
  isCacheFresh,
  isPostDetailFresh,
  loadCreatorCache,
  markArchiveChunkVerified,
  mergeArchiveChunk,
  pruneCacheChunks,
  pruneCachePostDetails,
  writeCreatorCache,
} from "./cache.js";

describe("cache utils", () => {
  it("isCacheFresh checks max age window", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    expect(isCacheFresh({ updatedAt: 9_500 })).toBe(true);
    expect(isCacheFresh({ updatedAt: -100_000_000 })).toBe(false);
    expect(isCacheFresh({})).toBe(false);
    vi.restoreAllMocks();
  });

  it("isPostDetailFresh uses a stricter age window and requires payload", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);

    expect(isPostDetailFresh({ data: { id: "post" }, updatedAt: 9_000 })).toBe(true);
    expect(isPostDetailFresh({ data: { id: "post" }, updatedAt: -5 })).toBe(false);
    expect(isPostDetailFresh({ updatedAt: 9_000 })).toBe(false);
    expect(isPostDetailFresh({ data: { id: "post" }, updatedAt: 9_000 }, 500)).toBe(false);

    vi.restoreAllMocks();
  });

  it("pruneCacheChunks sorts by offset and caps total items", () => {
    const chunks = {
      "2500": Array.from({ length: 3000 }, (_, index) => ({ id: `a-${index}` })),
      "0": Array.from({ length: 3000 }, (_, index) => ({ id: `b-${index}` })),
      bad: "not-array",
    };
    const pruned = pruneCacheChunks(chunks);

    expect(Object.keys(pruned)).toEqual(["0", "2500"]);
    expect(pruned["0"]).toHaveLength(3000);
    expect(pruned["2500"]).toHaveLength(2000);
  });

  it("pruneCachePostDetails keeps most recent entries only", () => {
    const details = {};
    for (let index = 0; index < 2100; index += 1) {
      details[`id-${index}`] = {
        data: { id: index },
        updatedAt: index,
        hydrated: index % 2 === 0,
      };
    }

    const pruned = pruneCachePostDetails(details);
    expect(Object.keys(pruned)).toHaveLength(2000);
    expect(pruned["id-2099"]).toBeDefined();
    expect(pruned["id-0"]).toBeUndefined();
  });

  it("mergeArchiveChunk keeps missing cached posts as archived-only", () => {
    const now = 2000;
    const merged = mergeArchiveChunk(
      [
        { id: "keep-me", title: "Old", firstSeenAt: 1000, lastSeenAt: 1500, lastVerifiedAt: 1500 },
        { id: "still-live", title: "Old live", firstSeenAt: 1001, lastSeenAt: 1501, lastVerifiedAt: 1501 },
      ],
      [{ id: "still-live", title: "Fresh live" }],
      now,
    );

    const live = merged.find((post) => post.id === "still-live");
    const archived = merged.find((post) => post.id === "keep-me");

    expect(live).toMatchObject({
      id: "still-live",
      title: "Fresh live",
      archivedOnly: false,
      firstSeenAt: 1001,
      lastSeenAt: now,
      lastVerifiedAt: now,
    });
    expect(archived).toMatchObject({
      id: "keep-me",
      archivedOnly: true,
      firstSeenAt: 1000,
      lastSeenAt: 1500,
      lastVerifiedAt: now,
    });
  });

  it("markArchiveChunkVerified only updates verification timestamps", () => {
    const verified = markArchiveChunkVerified(
      [{ id: "post-1", title: "A", firstSeenAt: 10, lastSeenAt: 12, archivedOnly: true }],
      500,
    );

    expect(verified[0]).toMatchObject({
      id: "post-1",
      title: "A",
      archivedOnly: true,
      firstSeenAt: 10,
      lastSeenAt: 12,
      lastVerifiedAt: 500,
    });
  });

  it("collectCachedPosts flattens sorted chunk entries with positions", () => {
    const posts = collectCachedPosts({
      chunks: {
        "50": [{ id: "c" }],
        "0": [
          { id: "a" },
          { id: "b" },
          ...Array.from({ length: 48 }, (_, index) => ({ id: `pad-${index}` })),
        ],
      },
    });

    expect(posts[0]).toMatchObject({ id: "a", __position: 0 });
    expect(posts[1]).toMatchObject({ id: "b", __position: 1 });
    expect(posts[50]).toMatchObject({ id: "c", __position: 50 });
  });

  it("writeCreatorCache updates in-memory cache and supports clearing entries", () => {
    const stored = writeCreatorCache("patreon", "50049787", {
      updatedAt: 111,
      chunks: { 0: [{ id: "a" }] },
    });
    expect(stored).toBe(true);
    expect(loadCreatorCache("patreon", "50049787")).toMatchObject({
      updatedAt: 111,
      chunks: { 0: [{ id: "a" }] },
    });

    const cleared = writeCreatorCache("patreon", "50049787", null);
    expect(cleared).toBe(true);
    expect(loadCreatorCache("patreon", "50049787")).toBeNull();
  });

  it("writeCreatorCache tolerates legacy localStorage removal failures", () => {
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    expect(
      writeCreatorCache("patreon", "50049787", {
        updatedAt: 321,
        chunks: { 0: [{ id: "b" }] },
      }),
    ).toBe(true);

    removeSpy.mockRestore();
  });
});
