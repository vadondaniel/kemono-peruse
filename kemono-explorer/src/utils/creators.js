const SAVED_CREATORS_STORAGE_KEY = "kemono.savedCreators";
const CREATOR_NAME_CACHE_KEY = "kemono.creatorNameCache";

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
