const createFakeIndexedDb = () => {
  const stores = new Map();

  const db = {
    objectStoreNames: {
      contains(name) {
        return stores.has(name);
      },
    },
    createObjectStore(name) {
      if (!stores.has(name)) {
        stores.set(name, new Map());
      }
      return {};
    },
    transaction(storeName) {
      if (!stores.has(storeName)) {
        stores.set(storeName, new Map());
      }
      const store = stores.get(storeName);
      const tx = {};
      let completed = false;
      const finish = () => {
        if (completed) return;
        completed = true;
        queueMicrotask(() => {
          if (typeof tx.oncomplete === "function") {
            tx.oncomplete();
          }
        });
      };

      tx.objectStore = () => ({
        get(key) {
          const request = {};
          queueMicrotask(() => {
            request.result = store.get(key);
            if (typeof request.onsuccess === "function") {
              request.onsuccess();
            }
          });
          return request;
        },
        put(value, key) {
          store.set(key, JSON.parse(JSON.stringify(value)));
          finish();
        },
        delete(key) {
          store.delete(key);
          finish();
        },
      });

      return tx;
    },
  };

  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = db;
        if (!stores.has("creator-cache") && typeof request.onupgradeneeded === "function") {
          request.onupgradeneeded();
        }
        if (typeof request.onsuccess === "function") {
          request.onsuccess();
        }
      });
      return request;
    },
  };

  return { indexedDB, stores };
};

describe("cache indexeddb integration", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("migrates legacy localStorage cache into indexeddb and removes legacy key", async () => {
    const { indexedDB, stores } = createFakeIndexedDb();
    Object.defineProperty(window, "indexedDB", { configurable: true, writable: true, value: indexedDB });

    const cacheKey = "kemono.cache.patreon.50049787";
    localStorage.setItem(
      cacheKey,
      JSON.stringify({
        version: 1,
        updatedAt: 123,
        chunks: {
          0: [{ id: "legacy-post" }],
        },
      }),
    );

    const cache = await import("./cache.js");
    const loaded = await cache.loadCreatorCacheAsync("patreon", "50049787");

    expect(loaded).toBeTruthy();
    expect(loaded.chunks["0"][0].id).toBe("legacy-post");
    expect(localStorage.getItem(cacheKey)).toBeNull();

    const store = stores.get("creator-cache");
    expect(store).toBeTruthy();
    expect(store.get(cacheKey).chunks["0"][0].id).toBe("legacy-post");
  });

  it("does not migrate legacy cache when migrateLegacy is false", async () => {
    const { indexedDB } = createFakeIndexedDb();
    Object.defineProperty(window, "indexedDB", { configurable: true, writable: true, value: indexedDB });

    const cacheKey = "kemono.cache.patreon.50049787";
    localStorage.setItem(
      cacheKey,
      JSON.stringify({
        version: 1,
        updatedAt: 123,
        chunks: {
          0: [{ id: "legacy-post" }],
        },
      }),
    );

    const cache = await import("./cache.js");
    const loaded = await cache.loadCreatorCacheAsync("patreon", "50049787", { migrateLegacy: false });

    expect(loaded).toBeNull();
    expect(localStorage.getItem(cacheKey)).not.toBeNull();
  });

  it("preserves write order for queued writes (last write wins)", async () => {
    const fake = createFakeIndexedDb();
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      writable: true,
      value: fake.indexedDB,
    });

    const cache = await import("./cache.js");

    await Promise.all([
      cache.writeCreatorCacheAsync("patreon", "50049787", {
        updatedAt: 1,
        chunks: { 0: [{ id: "first" }] },
      }),
      cache.writeCreatorCacheAsync("patreon", "50049787", {
        updatedAt: 2,
        chunks: { 0: [{ id: "second" }] },
      }),
    ]);

    vi.resetModules();
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      writable: true,
      value: fake.indexedDB,
    });
    const reloadedCache = await import("./cache.js");
    const loaded = await reloadedCache.loadCreatorCacheAsync("patreon", "50049787", {
      migrateLegacy: false,
    });

    expect(loaded.updatedAt).toBe(2);
    expect(loaded.chunks["0"][0].id).toBe("second");
  });

  it("keeps legacy cache when indexeddb is unavailable", async () => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      writable: true,
      value: null,
    });

    const cacheKey = "kemono.cache.patreon.50049787";
    localStorage.setItem(
      cacheKey,
      JSON.stringify({
        version: 1,
        updatedAt: 456,
        chunks: {
          0: [{ id: "legacy-only" }],
        },
      }),
    );

    const cache = await import("./cache.js");
    const loaded = await cache.loadCreatorCacheAsync("patreon", "50049787");

    expect(loaded).toBeTruthy();
    expect(loaded.chunks["0"][0].id).toBe("legacy-only");
    expect(localStorage.getItem(cacheKey)).not.toBeNull();
  });

  it("returns false from async write when indexeddb open throws", async () => {
    const failingIndexedDb = {
      open() {
        throw new Error("open failed");
      },
    };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      writable: true,
      value: failingIndexedDb,
    });

    const cache = await import("./cache.js");
    const result = await cache.writeCreatorCacheAsync("patreon", "50049787", {
      updatedAt: 999,
      chunks: { 0: [{ id: "payload" }] },
    });

    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();
  });
});
