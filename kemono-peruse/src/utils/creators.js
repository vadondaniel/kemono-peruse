import { getCachePreferenceKey, writeCreatorCache } from "./cache.js";

const SAVED_CREATORS_STORAGE_KEY = "kemono.savedCreators";
const CREATOR_NAME_CACHE_KEY = "kemono.creatorNameCache";
const CREATOR_DISPLAY_PREFIX = "kemono.display";
const CREATOR_FILTER_FIELDS_PREFIX = "kemono.filterFields";
const CREATOR_REVERSE_ORDER_PREFIX = "kemono.reverseOrder";
export const UNSAVED_CREATOR_SETTINGS_KEY = "__unsaved__";

const getLocalStorage = () => {
  if (typeof window === "undefined" || !window.localStorage) return null;
  return window.localStorage;
};

export const readSavedCreators = () => {
  const storage = getLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(SAVED_CREATORS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const findSavedCreatorEntry = (service, creatorId) => {
  if (!service || !creatorId) return null;
  const entries = readSavedCreators();
  return entries.find((entry) => entry && entry.service === service && entry.id === creatorId) || null;
};

export const getSavedCreatorName = (service, creatorId) => {
  const entry = findSavedCreatorEntry(service, creatorId);
  if (!entry) return null;
  const trimmed = typeof entry.name === "string" ? entry.name.trim() : "";
  if (trimmed) return trimmed;
  return entry.id || null;
};

export const readCreatorNameCache = () => {
  const storage = getLocalStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(CREATOR_NAME_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const getCachedCreatorName = (service, creatorId) => {
  if (!service || !creatorId) return null;
  const cache = readCreatorNameCache();
  const key = `${service}:${creatorId}`;
  const value = cache[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

export const cacheCreatorName = (service, creatorId, name) => {
  if (!service || !creatorId) return;
  if (findSavedCreatorEntry(service, creatorId)) return;
  const storage = getLocalStorage();
  if (!storage) return;
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return;
  try {
    const cache = readCreatorNameCache();
    const key = `${service}:${creatorId}`;
    if (cache[key] === trimmed) return;
    cache[key] = trimmed;
    storage.setItem(CREATOR_NAME_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore cache persistence failures
  }
};

const buildScopedKey = (prefix, service, creatorId) => {
  if (!prefix || !service || !creatorId) return null;
  const normalizedService = String(service).trim();
  const normalizedId = String(creatorId).trim();
  if (!normalizedService || !normalizedId) return null;
  return `${prefix}.${normalizedService}.${normalizedId}`;
};

const getScopedOrSharedKey = (prefix, service, creatorId, alreadySaved) => {
  if (!prefix) return null;
  if (!alreadySaved) {
    return `${prefix}.${UNSAVED_CREATOR_SETTINGS_KEY}`;
  }
  return buildScopedKey(prefix, service, creatorId);
};

export const getCreatorScopedStorageKey = (prefix, service, creatorId, alreadySaved) =>
  getScopedOrSharedKey(prefix, service, creatorId, alreadySaved);

const removeScopedItem = (prefix, service, creatorId) => {
  const storage = getLocalStorage();
  if (!storage) return;
  const key = buildScopedKey(prefix, service, creatorId);
  if (!key) return;
  try {
    storage.removeItem(key);
  } catch {
    // ignore removal failures
  }
};

export const purgeCreatorLocalState = (service, creatorId) => {
  if (!service || !creatorId) return;
  removeScopedItem(CREATOR_DISPLAY_PREFIX, service, creatorId);
  removeScopedItem(CREATOR_FILTER_FIELDS_PREFIX, service, creatorId);
  removeScopedItem(CREATOR_REVERSE_ORDER_PREFIX, service, creatorId);
  const storage = getLocalStorage();
  if (storage) {
    try {
      const cachePrefKey = getCachePreferenceKey(service, creatorId);
      storage.removeItem(cachePrefKey);
    } catch {
      // ignore failures clearing cache preference
    }
  }
  writeCreatorCache(service, creatorId, null);
};

export const copyUnsavedCreatorSettingsTo = (service, creatorId) => {
  if (!service || !creatorId) return;
  const storage = getLocalStorage();
  if (!storage) return;
  const targetDisplayKey = buildScopedKey(CREATOR_DISPLAY_PREFIX, service, creatorId);
  const targetReverseKey = buildScopedKey(CREATOR_REVERSE_ORDER_PREFIX, service, creatorId);
  if (!targetDisplayKey && !targetReverseKey) return;
  try {
    if (targetDisplayKey) {
      const unsavedDisplay = storage.getItem(`${CREATOR_DISPLAY_PREFIX}.${UNSAVED_CREATOR_SETTINGS_KEY}`);
      if (unsavedDisplay) {
        storage.setItem(targetDisplayKey, unsavedDisplay);
      }
    }
  } catch {
    // ignore
  }
  try {
    if (targetReverseKey) {
      const unsavedReverse = storage.getItem(`${CREATOR_REVERSE_ORDER_PREFIX}.${UNSAVED_CREATOR_SETTINGS_KEY}`);
      if (unsavedReverse) {
        storage.setItem(targetReverseKey, unsavedReverse);
      }
    }
  } catch {
    // ignore
  }
};

export const resolveProfileDisplayName = (profile) => {
  if (!profile || typeof profile !== "object") return null;
  const candidates = [
    profile.name,
    profile.display_name,
    profile.username,
    profile.user,
    profile.creator,
    profile.title,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
};
