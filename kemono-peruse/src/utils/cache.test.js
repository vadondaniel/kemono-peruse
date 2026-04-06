import {
  collectCachedPosts,
  isCacheFresh,
  isPostDetailFresh,
  loadCreatorCache,
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
      "100": Array.from({ length: 600 }, (_, index) => ({ id: `a-${index}` })),
      "0": Array.from({ length: 600 }, (_, index) => ({ id: `b-${index}` })),
      bad: "not-array",
    };
    const pruned = pruneCacheChunks(chunks);

    expect(Object.keys(pruned)).toEqual(["0", "100"]);
    expect(pruned["0"]).toHaveLength(600);
    expect(pruned["100"]).toHaveLength(400);
  });

  it("pruneCachePostDetails keeps most recent entries only", () => {
    const details = {};
    for (let index = 0; index < 120; index += 1) {
      details[`id-${index}`] = {
        data: { id: index },
        updatedAt: index,
        hydrated: index % 2 === 0,
      };
    }

    const pruned = pruneCachePostDetails(details);
    expect(Object.keys(pruned)).toHaveLength(100);
    expect(pruned["id-119"]).toBeDefined();
    expect(pruned["id-0"]).toBeUndefined();
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
