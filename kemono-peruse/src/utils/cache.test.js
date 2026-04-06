import {
  collectCachedPosts,
  isCacheFresh,
  pruneCacheChunks,
  pruneCachePostDetails,
} from "./cache.js";

describe("cache utils", () => {
  it("isCacheFresh checks max age window", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    expect(isCacheFresh({ updatedAt: 9_500 })).toBe(true);
    expect(isCacheFresh({ updatedAt: -100_000_000 })).toBe(false);
    expect(isCacheFresh({})).toBe(false);
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
});
