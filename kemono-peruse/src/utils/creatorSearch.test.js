import { runCreatorDirectorySearch } from "./creatorSearch.js";

const creators = [
  {
    id: "50049787",
    idLower: "50049787",
    service: "patreon",
    name: "AYEH",
    nameLower: "ayeh",
    favorited: 200,
    indexed: 1700000000000,
    updated: 1700000005000,
  },
  {
    id: "1234",
    idLower: "1234",
    service: "fanbox",
    name: "Alpha Artist",
    nameLower: "alpha artist",
    favorited: 50,
    indexed: 1690000000000,
    updated: 1690000005000,
  },
  {
    id: "9876",
    idLower: "9876",
    service: "patreon",
    name: "Alpha Alt",
    nameLower: "alpha alt",
    favorited: 50,
    indexed: 1690000009000,
    updated: 1690000009000,
  },
];

describe("runCreatorDirectorySearch", () => {
  it("returns empty result when tokens are missing", () => {
    const result = runCreatorDirectorySearch({
      directory: creators,
      serviceFilter: "all",
      tokens: [],
      limit: 30,
    });

    expect(result).toEqual({ results: [], total: 0 });
  });

  it("filters by service and matches name/id tokens case-insensitively", () => {
    const result = runCreatorDirectorySearch({
      directory: creators,
      serviceFilter: "patreon",
      tokens: ["ALPHA"],
      limit: 30,
    });

    expect(result.total).toBe(1);
    expect(result.results[0].id).toBe("9876");
  });

  it("sorts by favorited desc, then updated desc, then indexed desc", () => {
    const result = runCreatorDirectorySearch({
      directory: creators,
      serviceFilter: "all",
      tokens: ["a"],
      limit: 30,
    });

    expect(result.total).toBe(3);
    expect(result.results.map((entry) => entry.id)).toEqual(["50049787", "9876", "1234"]);
  });

  it("respects limit", () => {
    const result = runCreatorDirectorySearch({
      directory: creators,
      serviceFilter: "all",
      tokens: ["a"],
      limit: 2,
    });

    expect(result.total).toBe(3);
    expect(result.results).toHaveLength(2);
  });
});
