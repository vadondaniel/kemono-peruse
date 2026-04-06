import {
  API_PAGE_SIZE,
  CACHE_DATA_PREFIX,
  CACHE_MAX_AGE_MS,
  CACHE_PREF_PREFIX,
  CACHE_VERSION,
  MAX_CACHE_POSTS,
  MAX_CACHE_POST_DETAILS,
} from "../constants";

const CREATOR_CACHE_DB_NAME = "kemono-peruse-cache";
const CREATOR_CACHE_DB_VERSION = 1;
const CREATOR_CACHE_STORE = "creator-cache";
const SPLIT_META_RECORD_TYPE = "creator-cache-meta-v2";
const MAX_MEMORY_CACHE_CREATORS = 24;
const MAX_MEMORY_CACHE_BYTES = 24 * 1024 * 1024;
const MAX_PERSISTED_CACHE_CREATORS = 80;
const MAX_PERSISTED_CACHE_BYTES = 96 * 1024 * 1024;
const ACCESS_TOUCH_MIN_INTERVAL_MS = 30000;
const CACHE_WRITE_DEBOUNCE_MS = 120;
const cacheMemory = new Map();
const cacheMemoryMeta = new Map();
const writeQueues = new Map();
const debouncedWrites = new Map();
const accessTouchMap = new Map();
let dbPromise = null;
let maintenanceQueue = Promise.resolve();

export function getCachePreferenceKey(service, creatorId) {
  return `${CACHE_PREF_PREFIX}.${service}.${creatorId}`;
}

export function getCacheDataKey(service, creatorId) {
  return `${CACHE_DATA_PREFIX}.${service}.${creatorId}`;
}

const getCacheMetaKey = (key) => `${key}::meta`;
const getCacheChunkKey = (key, offset) => `${key}::chunk::${offset}`;
const getCachePostDetailKey = (key, postId) => `${key}::detail::${postId}`;
const parseRootKeyFromMetaKey = (value) => {
  if (typeof value !== "string" || !value.endsWith("::meta")) return "";
  return value.slice(0, -6);
};

const estimatePayloadSize = (payload) => {
  if (!payload || typeof payload !== "object") return 0;
  try {
    return JSON.stringify(payload).length;
  } catch {
    return 0;
  }
};

const getTotalMemorySize = () => {
  let total = 0;
  cacheMemoryMeta.forEach((meta) => {
    total += Number(meta?.sizeEstimate) || 0;
  });
  return total;
};

const dropMemoryEntry = (key) => {
  cacheMemory.delete(key);
  cacheMemoryMeta.delete(key);
  accessTouchMap.delete(key);
};

const enforceMemoryCacheLimits = (protectedKey = "") => {
  let creatorCount = cacheMemory.size;
  let totalSize = getTotalMemorySize();
  if (creatorCount <= MAX_MEMORY_CACHE_CREATORS && totalSize <= MAX_MEMORY_CACHE_BYTES) {
    return;
  }

  const ordered = Array.from(cacheMemoryMeta.entries())
    .filter(([key]) => key !== protectedKey)
    .sort((left, right) => {
      const leftTime = Number(left[1]?.lastAccessedAt) || 0;
      const rightTime = Number(right[1]?.lastAccessedAt) || 0;
      return leftTime - rightTime;
    });

  for (const [key, meta] of ordered) {
    if (creatorCount <= MAX_MEMORY_CACHE_CREATORS && totalSize <= MAX_MEMORY_CACHE_BYTES) {
      break;
    }
    creatorCount -= 1;
    totalSize -= Number(meta?.sizeEstimate) || 0;
    dropMemoryEntry(key);
  }
};

const trackMemoryPayload = (key, payload, options = {}) => {
  if (!key) return;
  const { lastAccessedAt = Date.now(), sizeEstimate = estimatePayloadSize(payload) } = options;
  cacheMemory.delete(key);
  cacheMemory.set(key, payload);
  cacheMemoryMeta.set(key, {
    lastAccessedAt: Number.isFinite(lastAccessedAt) ? Math.floor(lastAccessedAt) : Date.now(),
    sizeEstimate: Number.isFinite(sizeEstimate) && sizeEstimate >= 0 ? Math.floor(sizeEstimate) : 0,
  });
  enforceMemoryCacheLimits(key);
};

const touchMemoryEntry = (key) => {
  if (!key || !cacheMemory.has(key)) return;
  const payload = cacheMemory.get(key);
  const existing = cacheMemoryMeta.get(key) || {};
  trackMemoryPayload(key, payload, {
    lastAccessedAt: Date.now(),
    sizeEstimate: Number.isFinite(existing.sizeEstimate)
      ? existing.sizeEstimate
      : estimatePayloadSize(payload),
  });
};

const queueMaintenance = (task) => {
  maintenanceQueue = maintenanceQueue
    .catch(() => null)
    .then(() => task())
    .catch((error) => {
      console.error("Cache maintenance failed", error);
      return null;
    });
  return maintenanceQueue;
};

const getIndexedDb = () => {
  if (typeof window === "undefined") return null;
  return window.indexedDB || null;
};

const normalizeCachePayload = (value) => {
  if (!value || typeof value !== "object" || value.version !== CACHE_VERSION) return null;
  const parsed = { ...value };
  if (parsed.chunks && typeof parsed.chunks === "object") {
    Object.keys(parsed.chunks).forEach((offset) => {
      if (!Array.isArray(parsed.chunks[offset])) {
        delete parsed.chunks[offset];
      }
    });
  }
  if (parsed.postDetails && typeof parsed.postDetails === "object") {
    Object.keys(parsed.postDetails).forEach((postId) => {
      const entry = parsed.postDetails[postId];
      if (!entry || typeof entry !== "object" || !entry.data) {
        delete parsed.postDetails[postId];
        return;
      }
      parsed.postDetails[postId] = {
        ...entry,
        hydrated: Boolean(entry.hydrated),
      };
    });
  }
  return parsed;
};

const splitCachePayload = (payload) => {
  const normalized = normalizeCachePayload(payload);
  if (!normalized) return null;

  const base = { ...normalized };
  delete base.chunks;
  delete base.postDetails;
  delete base.version;

  const chunks =
    normalized.chunks && typeof normalized.chunks === "object" ? normalized.chunks : {};
  const postDetails =
    normalized.postDetails && typeof normalized.postDetails === "object"
      ? normalized.postDetails
      : {};

  const chunkKeys = Object.keys(chunks);
  const detailKeys = Object.keys(postDetails);

  return {
    base,
    chunks,
    postDetails,
    chunkKeys,
    detailKeys,
  };
};

const normalizeMetaRecord = (value, metaKey = "") => {
  if (!value || typeof value !== "object") return null;
  if (value.type !== SPLIT_META_RECORD_TYPE || value.version !== CACHE_VERSION) return null;
  const base = value.base && typeof value.base === "object" ? { ...value.base } : {};
  delete base.version;
  delete base.chunks;
  delete base.postDetails;
  const rootKey =
    (typeof value.rootKey === "string" && value.rootKey) || parseRootKeyFromMetaKey(metaKey);
  const chunkKeys = Array.isArray(value.chunkKeys)
    ? [...new Set(value.chunkKeys.map((key) => String(key || "")).filter(Boolean))]
    : [];
  const detailKeys = Array.isArray(value.detailKeys)
    ? [...new Set(value.detailKeys.map((key) => String(key || "")).filter(Boolean))]
    : [];
  const lastAccessedAt = Number(value.lastAccessedAt);
  const sizeEstimate = Number(value.sizeEstimate);
  return {
    metaKey: typeof metaKey === "string" ? metaKey : "",
    rootKey,
    base,
    chunkKeys,
    detailKeys,
    lastAccessedAt:
      Number.isFinite(lastAccessedAt) && lastAccessedAt >= 0 ? Math.floor(lastAccessedAt) : 0,
    sizeEstimate: Number.isFinite(sizeEstimate) && sizeEstimate >= 0 ? Math.floor(sizeEstimate) : 0,
  };
};

const valuesEqual = (left, right) => {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

const readLegacyLocalStorageCache = (key) => {
  if (typeof window === "undefined" || !window.localStorage || !key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizeCachePayload(parsed);
  } catch {
    return null;
  }
};

const removeLegacyLocalStorageCache = (key) => {
  if (typeof window === "undefined" || !window.localStorage || !key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore legacy cleanup failures
  }
};

const openCacheDb = () => {
  const indexedDb = getIndexedDb();
  if (!indexedDb) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDb.open(CREATOR_CACHE_DB_NAME, CREATOR_CACHE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CREATOR_CACHE_STORE)) {
          db.createObjectStore(CREATOR_CACHE_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.error("Failed to open creator cache database", request.error);
        resolve(null);
      };
    } catch (error) {
      console.error("Failed to initialize creator cache database", error);
      resolve(null);
    }
  });

  return dbPromise;
};

const readDbRecord = (db, recordKey, errorMessage) => {
  if (!db || !recordKey) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CREATOR_CACHE_STORE, "readonly");
      const store = tx.objectStore(CREATOR_CACHE_STORE);
      const request = store.get(recordKey);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => {
        console.error(errorMessage, request.error);
        resolve(null);
      };
    } catch (error) {
      console.error(errorMessage, error);
      resolve(null);
    }
  });
};

const readDbRecords = (db, recordKeys, errorMessage) => {
  if (!db || !Array.isArray(recordKeys) || recordKeys.length === 0) {
    return Promise.resolve([]);
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CREATOR_CACHE_STORE, "readonly");
      const store = tx.objectStore(CREATOR_CACHE_STORE);
      const values = new Array(recordKeys.length);
      let pending = recordKeys.length;
      let failed = false;

      recordKeys.forEach((recordKey, index) => {
        const request = store.get(recordKey);
        request.onsuccess = () => {
          values[index] = request.result ?? null;
          pending -= 1;
          if (pending === 0) {
            resolve(failed ? null : values);
          }
        };
        request.onerror = () => {
          if (!failed) {
            console.error(errorMessage, request.error);
          }
          failed = true;
          pending -= 1;
          if (pending === 0) {
            resolve(null);
          }
        };
      });
    } catch (error) {
      console.error(errorMessage, error);
      resolve(null);
    }
  });
};

const listMetaRecordsFromDb = (db) => {
  if (!db) return Promise.resolve([]);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CREATOR_CACHE_STORE, "readonly");
      const store = tx.objectStore(CREATOR_CACHE_STORE);
      if (typeof store.openCursor !== "function") {
        resolve([]);
        return;
      }

      const entries = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(entries);
          return;
        }
        const meta = normalizeMetaRecord(cursor.value, cursor.key);
        if (meta?.rootKey) {
          entries.push(meta);
        }
        cursor.continue();
      };
      request.onerror = () => {
        console.error("Failed to read cache metadata for eviction", request.error);
        resolve([]);
      };
    } catch (error) {
      console.error("Failed to read cache metadata for eviction", error);
      resolve([]);
    }
  });
};

const deleteCreatorCacheByMeta = (store, meta) => {
  if (!store || !meta?.rootKey) return;
  const metaKey = meta.metaKey || getCacheMetaKey(meta.rootKey);
  (meta.chunkKeys || []).forEach((offset) => {
    store.delete(getCacheChunkKey(meta.rootKey, offset));
  });
  (meta.detailKeys || []).forEach((postId) => {
    store.delete(getCachePostDetailKey(meta.rootKey, postId));
  });
  store.delete(metaKey);
  store.delete(meta.rootKey);
};

const enforceGlobalCacheLimits = async (keepKey = "") => {
  const db = await openCacheDb();
  if (!db) return;

  const metas = await listMetaRecordsFromDb(db);
  if (!metas.length) return;

  let creatorCount = metas.length;
  let totalSize = metas.reduce((sum, meta) => sum + (Number(meta?.sizeEstimate) || 0), 0);
  if (creatorCount <= MAX_PERSISTED_CACHE_CREATORS && totalSize <= MAX_PERSISTED_CACHE_BYTES) {
    return;
  }

  const victims = [];
  const ordered = [...metas].sort((left, right) => {
    const leftTime = Number(left?.lastAccessedAt) || 0;
    const rightTime = Number(right?.lastAccessedAt) || 0;
    return leftTime - rightTime;
  });

  for (const meta of ordered) {
    if (creatorCount <= MAX_PERSISTED_CACHE_CREATORS && totalSize <= MAX_PERSISTED_CACHE_BYTES) {
      break;
    }
    if (meta.rootKey === keepKey) continue;
    victims.push(meta);
    creatorCount -= 1;
    totalSize -= Number(meta?.sizeEstimate) || 0;
  }

  if (!victims.length) return;

  await new Promise((resolve) => {
    try {
      const tx = db.transaction(CREATOR_CACHE_STORE, "readwrite");
      const store = tx.objectStore(CREATOR_CACHE_STORE);
      victims.forEach((meta) => {
        deleteCreatorCacheByMeta(store, meta);
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => {
        console.error("Failed to evict creator cache entries", tx.error);
        resolve(false);
      };
      tx.onabort = () => resolve(false);
    } catch (error) {
      console.error("Failed to evict creator cache entries", error);
      resolve(false);
    }
  });

  victims.forEach((meta) => {
    dropMemoryEntry(meta.rootKey);
  });
};

const touchCacheAccess = (key, payload = null) => {
  if (!key) return;
  const now = Date.now();
  const lastTouch = accessTouchMap.get(key) || 0;
  if (now - lastTouch < ACCESS_TOUCH_MIN_INTERVAL_MS) return;
  accessTouchMap.set(key, now);
  const sizeEstimate = payload ? estimatePayloadSize(payload) : null;

  void queueMaintenance(async () => {
    const db = await openCacheDb();
    if (!db) return;
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(CREATOR_CACHE_STORE, "readwrite");
        const store = tx.objectStore(CREATOR_CACHE_STORE);
        const metaKey = getCacheMetaKey(key);
        const request = store.get(metaKey);
        request.onsuccess = () => {
          const meta = normalizeMetaRecord(request.result, metaKey);
          if (!meta) return;
          store.put(
            {
              type: SPLIT_META_RECORD_TYPE,
              version: CACHE_VERSION,
              rootKey: meta.rootKey || key,
              base: meta.base,
              chunkKeys: meta.chunkKeys,
              detailKeys: meta.detailKeys,
              lastAccessedAt: now,
              sizeEstimate:
                Number.isFinite(sizeEstimate) && sizeEstimate >= 0 ? sizeEstimate : meta.sizeEstimate,
            },
            metaKey,
          );
        };
        request.onerror = () => {
          // ignore access touch failure
        };
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  });
};

const readSplitCacheFromDb = async (db, key) => {
  const metaKey = getCacheMetaKey(key);
  const meta = normalizeMetaRecord(
    await readDbRecord(db, metaKey, "Failed to read creator cache from indexeddb"),
    metaKey,
  );
  if (!meta) return null;

  const chunkRecordKeys = meta.chunkKeys.map((offset) => getCacheChunkKey(key, offset));
  const detailRecordKeys = meta.detailKeys.map((postId) => getCachePostDetailKey(key, postId));

  const [chunkValues, detailValues] = await Promise.all([
    readDbRecords(db, chunkRecordKeys, "Failed to read creator cache from indexeddb"),
    readDbRecords(db, detailRecordKeys, "Failed to read creator cache from indexeddb"),
  ]);

  if (chunkValues === null || detailValues === null) {
    return null;
  }

  const chunks = {};
  meta.chunkKeys.forEach((offset, index) => {
    const value = chunkValues[index];
    if (Array.isArray(value)) {
      chunks[offset] = value;
    }
  });

  const postDetails = {};
  meta.detailKeys.forEach((postId, index) => {
    const value = detailValues[index];
    if (value && typeof value === "object" && value.data) {
      postDetails[postId] = { ...value, hydrated: Boolean(value.hydrated) };
    }
  });

  const combined = { version: CACHE_VERSION, ...meta.base };
  if (Object.keys(chunks).length > 0) {
    combined.chunks = chunks;
  }
  if (Object.keys(postDetails).length > 0) {
    combined.postDetails = postDetails;
  }
  return normalizeCachePayload(combined);
};

const readLegacyBlobCacheFromDb = async (db, key) => {
  const record = await readDbRecord(db, key, "Failed to read creator cache from indexeddb");
  return normalizeCachePayload(record);
};

const readCacheFromDb = async (key) => {
  const db = await openCacheDb();
  if (!db || !key) return null;

  const splitPayload = await readSplitCacheFromDb(db, key);
  if (splitPayload) {
    touchCacheAccess(key, splitPayload);
    return splitPayload;
  }

  const legacyBlob = await readLegacyBlobCacheFromDb(db, key);
  if (legacyBlob) {
    void queueCacheWrite(key, legacyBlob, null);
    touchCacheAccess(key, legacyBlob);
    return legacyBlob;
  }

  return null;
};

const writeCacheToDb = async (key, payload, previousPayload = null) => {
  const db = await openCacheDb();
  if (!db || !key) return false;

  const previousParts = splitCachePayload(previousPayload);

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CREATOR_CACHE_STORE, "readwrite");
      const store = tx.objectStore(CREATOR_CACHE_STORE);
      const metaKey = getCacheMetaKey(key);

      const deleteByParts = (parts) => {
        const chunkKeys = parts?.chunkKeys || [];
        const detailKeys = parts?.detailKeys || [];
        chunkKeys.forEach((offset) => {
          store.delete(getCacheChunkKey(key, offset));
        });
        detailKeys.forEach((postId) => {
          store.delete(getCachePostDetailKey(key, postId));
        });
        store.delete(metaKey);
        // remove any pre-split legacy blob
        store.delete(key);
      };

      const applyWrite = (partsForDiff) => {
        const nextParts = splitCachePayload(payload);
        if (!nextParts) {
          deleteByParts(partsForDiff);
          return;
        }
        const lastAccessedAt = Date.now();
        const sizeEstimate = estimatePayloadSize(payload);

        const nextChunkSet = new Set(nextParts.chunkKeys);
        const nextDetailSet = new Set(nextParts.detailKeys);
        const previousChunkKeys = partsForDiff?.chunkKeys || [];
        const previousDetailKeys = partsForDiff?.detailKeys || [];

        previousChunkKeys.forEach((offset) => {
          if (!nextChunkSet.has(offset)) {
            store.delete(getCacheChunkKey(key, offset));
          }
        });
        previousDetailKeys.forEach((postId) => {
          if (!nextDetailSet.has(postId)) {
            store.delete(getCachePostDetailKey(key, postId));
          }
        });

        nextParts.chunkKeys.forEach((offset) => {
          const previousChunk = partsForDiff?.chunks?.[offset];
          const nextChunk = nextParts.chunks[offset];
          if (!partsForDiff?.chunks || !valuesEqual(previousChunk, nextChunk)) {
            store.put(nextChunk, getCacheChunkKey(key, offset));
          }
        });
        nextParts.detailKeys.forEach((postId) => {
          const previousDetail = partsForDiff?.postDetails?.[postId];
          const nextDetail = nextParts.postDetails[postId];
          if (!partsForDiff?.postDetails || !valuesEqual(previousDetail, nextDetail)) {
            store.put(nextDetail, getCachePostDetailKey(key, postId));
          }
        });

        store.put(
          {
            type: SPLIT_META_RECORD_TYPE,
            version: CACHE_VERSION,
            rootKey: key,
            base: nextParts.base,
            chunkKeys: nextParts.chunkKeys,
            detailKeys: nextParts.detailKeys,
            lastAccessedAt,
            sizeEstimate,
          },
          metaKey,
        );
        // cleanup legacy blob key after split write succeeds
        store.delete(key);
      };

      if (!payload) {
        if (previousParts) {
          deleteByParts(previousParts);
        } else {
          const metaRequest = store.get(metaKey);
          metaRequest.onsuccess = () => {
            const fromMeta = normalizeMetaRecord(metaRequest.result, metaKey);
            deleteByParts(fromMeta);
          };
          metaRequest.onerror = () => {
            console.error("Failed to persist creator cache to indexeddb", metaRequest.error);
            deleteByParts(null);
          };
        }
      } else if (previousParts) {
        applyWrite(previousParts);
      } else {
        const metaRequest = store.get(metaKey);
        metaRequest.onsuccess = () => {
          const fromMeta = normalizeMetaRecord(metaRequest.result, metaKey);
          applyWrite(fromMeta);
        };
        metaRequest.onerror = () => {
          console.error("Failed to persist creator cache to indexeddb", metaRequest.error);
          applyWrite(null);
        };
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => {
        console.error("Failed to persist creator cache to indexeddb", tx.error);
        resolve(false);
      };
      tx.onabort = () => resolve(false);
    } catch (error) {
      console.error("Failed to persist creator cache to indexeddb", error);
      resolve(false);
    }
  });
};

const enqueueCacheWrite = (key, payload, previousPayload = null) => {
  const previous = writeQueues.get(key) || Promise.resolve(true);
  const queued = previous
    .catch(() => true)
    .then(async () => {
      const success = await writeCacheToDb(key, payload, previousPayload);
      if (success) {
        await queueMaintenance(() => enforceGlobalCacheLimits(key));
      }
      return success;
    })
    .finally(() => {
      if (writeQueues.get(key) === queued) {
        writeQueues.delete(key);
      }
    });
  writeQueues.set(key, queued);
  return queued;
};

const flushDebouncedCacheWrite = (key) => {
  const pending = debouncedWrites.get(key);
  if (!pending) return;
  debouncedWrites.delete(key);
  clearTimeout(pending.timerId);
  void enqueueCacheWrite(key, pending.payload, pending.previousPayload)
    .then((result) => pending.resolve(result))
    .catch(() => pending.resolve(false));
};

const queueCacheWrite = (key, payload, previousPayload = null, options = {}) => {
  const debounceMs = Number(options?.debounceMs);
  const normalizedDebounceMs =
    Number.isFinite(debounceMs) && debounceMs > 0 ? Math.floor(debounceMs) : 0;
  const hasPendingQueue = writeQueues.has(key) || debouncedWrites.has(key);

  if (normalizedDebounceMs <= 0 || !hasPendingQueue) {
    return enqueueCacheWrite(key, payload, previousPayload);
  }

  const existing = debouncedWrites.get(key);
  if (existing) {
    existing.payload = payload;
    if (!existing.previousPayload && previousPayload) {
      existing.previousPayload = previousPayload;
    }
    clearTimeout(existing.timerId);
    existing.timerId = setTimeout(() => flushDebouncedCacheWrite(key), normalizedDebounceMs);
    return existing.promise;
  }

  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  const pending = {
    payload,
    previousPayload,
    promise,
    resolve: resolvePromise,
    timerId: setTimeout(() => flushDebouncedCacheWrite(key), normalizedDebounceMs),
  };
  debouncedWrites.set(key, pending);
  return promise;
};

export function loadCreatorCache(service, creatorId) {
  const key = getCacheDataKey(service, creatorId);
  if (!key) return null;
  const memoryEntry = cacheMemory.get(key) ?? null;
  if (memoryEntry) {
    touchMemoryEntry(key);
    touchCacheAccess(key, memoryEntry);
  }
  return memoryEntry;
}

const isQuotaExceededError = (error) => {
  if (!error) return false;
  if (error.name === "QuotaExceededError" || error.code === 22) return true;
  if (typeof window !== "undefined" && window.DOMException) {
    return error instanceof window.DOMException && error.name === "QuotaExceededError";
  }
  return false;
};

export function writeCreatorCache(service, creatorId, data) {
  const key = getCacheDataKey(service, creatorId);
  if (!key) return true;
  const previousPayload = cacheMemory.get(key) ?? null;
  const payload = data ? normalizeCachePayload({ version: CACHE_VERSION, ...data }) : null;
  if (payload) {
    trackMemoryPayload(key, payload);
  } else {
    dropMemoryEntry(key);
  }
  removeLegacyLocalStorageCache(key);
  void queueCacheWrite(key, payload, previousPayload, { debounceMs: CACHE_WRITE_DEBOUNCE_MS });
  return true;
}

export async function loadCreatorCacheAsync(service, creatorId, options = {}) {
  const key = getCacheDataKey(service, creatorId);
  if (!key) return null;
  const { migrateLegacy = true } = options || {};
  const memoryEntry = cacheMemory.get(key);
  if (memoryEntry) {
    touchMemoryEntry(key);
    touchCacheAccess(key, memoryEntry);
    return memoryEntry;
  }

  const fromDb = await readCacheFromDb(key);
  if (fromDb) {
    trackMemoryPayload(key, fromDb);
    return fromDb;
  }

  if (!migrateLegacy) {
    dropMemoryEntry(key);
    return null;
  }

  const legacy = readLegacyLocalStorageCache(key);
  if (!legacy) {
    dropMemoryEntry(key);
    return null;
  }

  trackMemoryPayload(key, legacy);
  const migrated = await queueCacheWrite(key, legacy, null);
  if (migrated) {
    removeLegacyLocalStorageCache(key);
  }
  return legacy;
}

export async function writeCreatorCacheAsync(service, creatorId, data) {
  const key = getCacheDataKey(service, creatorId);
  if (!key) return true;
  const previousPayload = cacheMemory.get(key) ?? null;
  const payload = data ? normalizeCachePayload({ version: CACHE_VERSION, ...data }) : null;
  if (payload) {
    trackMemoryPayload(key, payload);
  } else {
    dropMemoryEntry(key);
  }
  removeLegacyLocalStorageCache(key);

  try {
    return await queueCacheWrite(key, payload, previousPayload, {
      debounceMs: CACHE_WRITE_DEBOUNCE_MS,
    });
  } catch (error) {
    if (isQuotaExceededError(error)) {
      dropMemoryEntry(key);
    }
    console.error("Failed to persist creator cache", error);
    return false;
  }
}

export function isCacheFresh(cache) {
  if (!cache || typeof cache.updatedAt !== "number") return false;
  return Date.now() - cache.updatedAt < CACHE_MAX_AGE_MS;
}

export function pruneCacheChunks(chunks) {
  if (!chunks) return undefined;
  const entries = Object.entries(chunks)
    .map(([offset, value]) => ({ offset: Number(offset), value: Array.isArray(value) ? value : [] }))
    .filter((entry) => entry.value.length > 0)
    .sort((a, b) => a.offset - b.offset);
  const pruned = {};
  let stored = 0;
  for (const entry of entries) {
    if (stored >= MAX_CACHE_POSTS) break;
    const remaining = MAX_CACHE_POSTS - stored;
    pruned[String(entry.offset)] =
      entry.value.length > remaining ? entry.value.slice(0, remaining) : entry.value.slice();
    stored += pruned[String(entry.offset)].length;
    if (entry.value.length < API_PAGE_SIZE) break;
  }
  return pruned;
}

export function pruneCachePostDetails(details) {
  if (!details) return undefined;
  const entries = Object.entries(details)
    .map(([postId, value]) => ({
      postId,
      data: value?.data,
      updatedAt: typeof value?.updatedAt === "number" ? value.updatedAt : 0,
      hydrated: Boolean(value?.hydrated),
    }))
    .filter((entry) => entry.data)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const pruned = {};
  entries.slice(0, MAX_CACHE_POST_DETAILS).forEach((entry) => {
    pruned[entry.postId] = {
      data: entry.data,
      updatedAt: entry.updatedAt || Date.now(),
      hydrated: entry.hydrated,
    };
  });
  return pruned;
}

export function collectCachedPosts(cache) {
  if (!cache || !cache.chunks) return null;
  const entries = Object.entries(cache.chunks)
    .map(([offset, value]) => ({ offset: Number(offset), value: Array.isArray(value) ? value : [] }))
    .filter((entry) => entry.value.length > 0)
    .sort((a, b) => a.offset - b.offset);
  if (!entries.length) return null;
  const posts = [];
  for (const entry of entries) {
    for (let index = 0; index < entry.value.length; index += 1) {
      if (posts.length >= MAX_CACHE_POSTS) break;
      const post = entry.value[index];
      if (!post || typeof post !== "object") continue;
      posts.push({ ...post, __position: entry.offset + index });
    }
    if (entry.value.length < API_PAGE_SIZE) break;
    if (posts.length >= MAX_CACHE_POSTS) break;
  }
  return posts.length ? posts.slice(0, MAX_CACHE_POSTS) : null;
}
