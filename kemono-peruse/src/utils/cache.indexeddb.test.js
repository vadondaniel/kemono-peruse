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

  it("normalizes migrated legacy payload by removing malformed chunks and details", async () => {
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
        updatedAt: 777,
        chunks: {
          0: [{ id: "ok" }],
          50: "bad chunk",
        },
        postDetails: {
          badNull: null,
          badMissingData: { hydrated: true },
          good: { data: { id: "post-1" }, hydrated: "yes" },
        },
      }),
    );

    const cache = await import("./cache.js");
    const loaded = await cache.loadCreatorCacheAsync("patreon", "50049787");

    expect(loaded).toBeTruthy();
    expect(loaded.chunks["0"]).toHaveLength(1);
    expect(loaded.chunks["50"]).toBeUndefined();
    expect(loaded.postDetails.badNull).toBeUndefined();
    expect(loaded.postDetails.badMissingData).toBeUndefined();
    expect(loaded.postDetails.good).toMatchObject({
      data: { id: "post-1" },
      hydrated: true,
    });
  });

  it("returns null for invalid legacy json payloads", async () => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      writable: true,
      value: null,
    });

    const cacheKey = "kemono.cache.patreon.50049787";
    localStorage.setItem(cacheKey, "{ this is not valid json");

    const cache = await import("./cache.js");
    const loaded = await cache.loadCreatorCacheAsync("patreon", "50049787");

    expect(loaded).toBeNull();
  });

  it("handles indexeddb open request errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failingIndexedDb = {
      open() {
        const request = {};
        queueMicrotask(() => {
          request.error = new Error("open request failed");
          if (typeof request.onerror === "function") {
            request.onerror();
          }
        });
        return request;
      },
    };
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      writable: true,
      value: failingIndexedDb,
    });

    const cache = await import("./cache.js");
    const result = await cache.writeCreatorCacheAsync("patreon", "50049787", {
      updatedAt: 1,
      chunks: { 0: [{ id: "x" }] },
    });

    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("handles indexeddb read request failures", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failingReadDb = {
      objectStoreNames: { contains: () => true },
      transaction() {
        return {
          objectStore() {
            return {
              get() {
                const request = {};
                queueMicrotask(() => {
                  request.error = new Error("read failed");
                  if (typeof request.onerror === "function") {
                    request.onerror();
                  }
                });
                return request;
              },
            };
          },
        };
      },
    };
    const indexedDb = {
      open() {
        const request = {};
        queueMicrotask(() => {
          request.result = failingReadDb;
          if (typeof request.onsuccess === "function") {
            request.onsuccess();
          }
        });
        return request;
      },
    };
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      writable: true,
      value: indexedDb,
    });

    const cache = await import("./cache.js");
    const loaded = await cache.loadCreatorCacheAsync("patreon", "50049787", { migrateLegacy: false });

    expect(loaded).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("handles indexeddb read transaction exceptions", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const throwingDb = {
      objectStoreNames: { contains: () => true },
      transaction() {
        throw new Error("tx failed");
      },
    };
    const indexedDb = {
      open() {
        const request = {};
        queueMicrotask(() => {
          request.result = throwingDb;
          if (typeof request.onsuccess === "function") {
            request.onsuccess();
          }
        });
        return request;
      },
    };
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      writable: true,
      value: indexedDb,
    });

    const cache = await import("./cache.js");
    const loaded = await cache.loadCreatorCacheAsync("patreon", "50049787", { migrateLegacy: false });

    expect(loaded).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("returns false when write transaction errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const writeErrorDb = {
      objectStoreNames: { contains: () => true },
      transaction() {
        const tx = {
          objectStore() {
            return {
              put() {},
              delete() {},
            };
          },
        };
        queueMicrotask(() => {
          tx.error = new Error("write failed");
          if (typeof tx.onerror === "function") {
            tx.onerror();
          }
        });
        return tx;
      },
    };
    const indexedDb = {
      open() {
        const request = {};
        queueMicrotask(() => {
          request.result = writeErrorDb;
          if (typeof request.onsuccess === "function") {
            request.onsuccess();
          }
        });
        return request;
      },
    };
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      writable: true,
      value: indexedDb,
    });

    const cache = await import("./cache.js");
    const result = await cache.writeCreatorCacheAsync("patreon", "50049787", {
      updatedAt: 2,
      chunks: { 0: [{ id: "payload" }] },
    });

    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("returns false when write transaction throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const throwingWriteDb = {
      objectStoreNames: { contains: () => true },
      transaction() {
        throw new Error("cannot write");
      },
    };
    const indexedDb = {
      open() {
        const request = {};
        queueMicrotask(() => {
          request.result = throwingWriteDb;
          if (typeof request.onsuccess === "function") {
            request.onsuccess();
          }
        });
        return request;
      },
    };
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      writable: true,
      value: indexedDb,
    });

    const cache = await import("./cache.js");
    const result = await cache.writeCreatorCacheAsync("patreon", "50049787", {
      updatedAt: 3,
      chunks: { 0: [{ id: "payload" }] },
    });

    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("supports deleting cache entries through async writer", async () => {
    const fake = createFakeIndexedDb();
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      writable: true,
      value: fake.indexedDB,
    });

    const cache = await import("./cache.js");
    await cache.writeCreatorCacheAsync("patreon", "50049787", {
      updatedAt: 10,
      chunks: { 0: [{ id: "exists" }] },
    });
    const removed = await cache.writeCreatorCacheAsync("patreon", "50049787", null);

    expect(removed).toBe(true);

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
    expect(loaded).toBeNull();
  });
});
