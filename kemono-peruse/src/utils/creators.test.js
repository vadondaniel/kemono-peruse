import { vi } from "vitest";

const writeCreatorCacheAsyncMock = vi.fn().mockResolvedValue(true);

vi.mock("./cache.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    writeCreatorCacheAsync: (...args) => writeCreatorCacheAsyncMock(...args),
  };
});

import {
  UNSAVED_CREATOR_SETTINGS_KEY,
  cacheCreatorName,
  copyUnsavedCreatorSettingsTo,
  findSavedCreatorEntry,
  getCachedCreatorName,
  getCreatorScopedStorageKey,
  getSavedCreatorName,
  purgeCreatorLocalState,
  readCreatorNameCache,
  readSavedCreators,
  resolveProfileDisplayName,
} from "./creators.js";

describe("creators utils", () => {
  beforeEach(() => {
    localStorage.clear();
    writeCreatorCacheAsyncMock.mockClear();
  });

  it("reads saved creators safely and resolves names", () => {
    localStorage.setItem(
      "kemono.savedCreators",
      JSON.stringify([
        { service: "patreon", id: "50049787", name: "AYEH" },
        { service: "fanbox", id: "1234", name: "   " },
      ]),
    );

    expect(readSavedCreators()).toHaveLength(2);
    expect(findSavedCreatorEntry("patreon", "50049787")).toMatchObject({ name: "AYEH" });
    expect(getSavedCreatorName("patreon", "50049787")).toBe("AYEH");
    expect(getSavedCreatorName("fanbox", "1234")).toBe("1234");
    expect(getSavedCreatorName("fanbox", "none")).toBeNull();
  });

  it("reads/writes creator name cache and skips saved creators", () => {
    cacheCreatorName("patreon", "50049787", "AYEH");
    expect(readCreatorNameCache()).toMatchObject({ "patreon:50049787": "AYEH" });
    expect(getCachedCreatorName("patreon", "50049787")).toBe("AYEH");

    localStorage.setItem(
      "kemono.savedCreators",
      JSON.stringify([{ service: "patreon", id: "50049787", name: "Saved Name" }]),
    );
    cacheCreatorName("patreon", "50049787", "Should Not Override");
    expect(getCachedCreatorName("patreon", "50049787")).toBe("AYEH");
  });

  it("builds scoped keys for saved and unsaved creators", () => {
    expect(getCreatorScopedStorageKey("kemono.display", "patreon", "50049787", true)).toBe(
      "kemono.display.patreon.50049787",
    );
    expect(getCreatorScopedStorageKey("kemono.display", "patreon", "50049787", false)).toBe(
      `kemono.display.${UNSAVED_CREATOR_SETTINGS_KEY}`,
    );
  });

  it("copies unsaved display/reverse settings into saved creator keys", () => {
    localStorage.setItem(`kemono.display.${UNSAVED_CREATOR_SETTINGS_KEY}`, '{"excerpts":true}');
    localStorage.setItem(`kemono.reverseOrder.${UNSAVED_CREATOR_SETTINGS_KEY}`, "true");

    copyUnsavedCreatorSettingsTo("patreon", "50049787");

    expect(localStorage.getItem("kemono.display.patreon.50049787")).toBe('{"excerpts":true}');
    expect(localStorage.getItem("kemono.reverseOrder.patreon.50049787")).toBe("true");
  });

  it("purges creator-local keys and requests cache deletion", async () => {
    localStorage.setItem("kemono.display.patreon.50049787", '{"excerpts":true}');
    localStorage.setItem("kemono.filterFields.patreon.50049787", '{"title":true}');
    localStorage.setItem("kemono.reverseOrder.patreon.50049787", "true");
    localStorage.setItem("kemono.cache.pref.patreon.50049787", "true");

    purgeCreatorLocalState("patreon", "50049787");

    expect(localStorage.getItem("kemono.display.patreon.50049787")).toBeNull();
    expect(localStorage.getItem("kemono.filterFields.patreon.50049787")).toBeNull();
    expect(localStorage.getItem("kemono.reverseOrder.patreon.50049787")).toBeNull();
    expect(localStorage.getItem("kemono.cache.pref.patreon.50049787")).toBeNull();
    expect(writeCreatorCacheAsyncMock).toHaveBeenCalledWith("patreon", "50049787", null);
  });

  it("resolves profile display name from prioritized fields", () => {
    expect(resolveProfileDisplayName({ display_name: "Display", name: "Name" })).toBe("Name");
    expect(resolveProfileDisplayName({ username: "UserName" })).toBe("UserName");
    expect(resolveProfileDisplayName({ title: "Title Here" })).toBe("Title Here");
    expect(resolveProfileDisplayName(null)).toBeNull();
  });
});
