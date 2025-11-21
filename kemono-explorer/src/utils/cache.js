import {
  API_PAGE_SIZE,
  CACHE_DATA_PREFIX,
  CACHE_MAX_AGE_MS,
  CACHE_PREF_PREFIX,
  CACHE_VERSION,
  MAX_CACHE_POSTS,
  MAX_CACHE_POST_DETAILS,
} from "../constants";

export function getCachePreferenceKey(service, creatorId) {
  return `${CACHE_PREF_PREFIX}.${service}.${creatorId}`;
}

export function getCacheDataKey(service, creatorId) {
  return `${CACHE_DATA_PREFIX}.${service}.${creatorId}`;
}

export function loadCreatorCache(service, creatorId) {
  if (typeof window === "undefined") return null;
  const key = getCacheDataKey(service, creatorId);
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed || parsed.version !== CACHE_VERSION) return null;
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
        entry.hydrated = Boolean(entry.hydrated);
      });
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeCreatorCache(service, creatorId, data) {
  if (typeof window === "undefined") return;
  const key = getCacheDataKey(service, creatorId);
  if (!data) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  const payload = { version: CACHE_VERSION, ...data };
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch (error) {
    console.error("Failed to persist creator cache", error);
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
    pruned[entry.postId] = { data: entry.data, updatedAt: entry.updatedAt || Date.now(), hydrated: entry.hydrated };
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
