import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Timestamp from "./Timestamp.jsx";
import {
  API_BASE,
  API_PAGE_SIZE,
  CACHE_VERSION,
  MAX_CACHE_POSTS,
  MAX_SEARCH_RESULTS,
  MEDIA_BASE,
  ORIGINAL_MEDIA_BASE,
  PAGE_SIZE_KEY,
  PAGE_SIZE_OPTIONS,
} from "../constants.js";
import { fetchJson } from "../utils/api.js";
import {
  getCachePreferenceKey,
  loadCreatorCache,
  loadCreatorCacheAsync,
  writeCreatorCacheAsync,
  isCacheFresh,
  pruneCacheChunks,
  pruneCachePostDetails,
  collectCachedPosts,
} from "../utils/cache.js";
import { formatDate } from "../utils/date.js";
import { extractTagTokens, getPostExcerptHtml, getServiceLabel, toNumericCount } from "../utils/posts.js";
import { cacheCreatorName, getCachedCreatorName, getSavedCreatorName, purgeCreatorLocalState, resolveProfileDisplayName, getCreatorScopedStorageKey } from "../utils/creators.js";
import { getInitialPageSize, readBooleanPreference } from "../utils/preferences.js";
import { getUrlForView } from "../utils/navigation.js";

const isModifiedClick = (event) =>
  event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;

const dedupePostsById = (items) => {
  const seen = new Set();
  const deduped = [];
  items.forEach((item, index) => {
    const key = item && item.id != null ? String(item.id) : `idx-${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });
  return deduped;
};

const resolveOffsetForPosition = (position, pageSize) => {
  if (!Number.isFinite(position) || !Number.isFinite(pageSize) || pageSize <= 0) return 0;
  return Math.max(0, Math.floor(position / pageSize) * pageSize);
};

const VIRTUAL_CARD_MIN_WIDTH = 260;
const VIRTUAL_GRID_GAP = 16;
const VIRTUAL_OVERSCAN_ROWS = 4;
const VIRTUALIZATION_MIN_ITEMS = 48;

const resolveVirtualRowHeight = ({ showExcerpts, showTags, showFeatureBackgrounds }) => {
  let estimate = 176;
  if (showTags) estimate += 34;
  if (showExcerpts) estimate += 98;
  if (showFeatureBackgrounds) estimate += 8;
  return estimate + VIRTUAL_GRID_GAP;
};

const resolvePostFeatureKey = (post, index) => {
  if (post && post.id != null) {
    return `post-${String(post.id)}`;
  }
  const fallbackPosition = Number.isFinite(post?.__position) ? post.__position : "na";
  const fallbackUpdated = post?.updated || post?.published || "na";
  return `post-fallback-${fallbackPosition}-${fallbackUpdated}-${index}`;
};

function CreatorPage({
  service,
  creatorId,
  creatorName,
  alreadySaved,
  onOpenPost,
  onSave,
  activeFilter,
  onUpdateFilter,
  initialPosition = 0,
  onRememberPosition,
}) {
  const cachePrefKey = getCachePreferenceKey(service, creatorId);
  const [useCache, setUseCache] = useState(() => readBooleanPreference(cachePrefKey, false));
  const [cacheData, setCacheData] = useState(() => loadCreatorCache(service, creatorId));
  const [cacheReloadApplied, setCacheReloadApplied] = useState(0);
  const [cacheStorageError, setCacheStorageError] = useState(false);
  const [cacheValidationState, setCacheValidationState] = useState("idle");
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const initialPageSizeRef = useRef(getInitialPageSize());
  const [limit, setLimit] = useState(initialPageSizeRef.current);
  const [offset, setOffset] = useState(() => resolveOffsetForPosition(initialPosition, initialPageSizeRef.current));
  const displayStorageKey = useMemo(
    () => getCreatorScopedStorageKey("kemono.display", service, creatorId, alreadySaved),
    [service, creatorId, alreadySaved],
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) return;
    if (!PAGE_SIZE_OPTIONS.includes(limit)) return;
    try {
      window.localStorage.setItem(PAGE_SIZE_KEY, String(limit));
    } catch {
      // ignore persistence issues
    }
  }, [limit]);
  const defaultDisplaySettings = { excerpts: false, tags: false, featureBackgrounds: false };
  const readDisplaySettings = () => {
    const base = { ...defaultDisplaySettings };
    if (typeof window === "undefined" || !window.localStorage) return base;
    if (!displayStorageKey) return base;
    try {
      const stored = window.localStorage.getItem(displayStorageKey);
      if (!stored) return base;
      const parsed = JSON.parse(stored);
      return {
        excerpts: Boolean(parsed?.excerpts),
        tags: Boolean(parsed?.tags),
        featureBackgrounds: Boolean(parsed?.featureBackgrounds),
      };
    } catch {
      return base;
    }
  };
  const writeDisplaySettings = (settings) => {
    if (typeof window === "undefined" || !window.localStorage) return;
    if (!displayStorageKey) return;
    try {
      const current = readDisplaySettings();
      const next = { ...current, ...settings };
      window.localStorage.setItem(displayStorageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  };
  const [showExcerpts, setShowExcerpts] = useState(() => readDisplaySettings().excerpts);
  const [showTags, setShowTags] = useState(() => readDisplaySettings().tags);
  const [showFeatureBackgrounds, setShowFeatureBackgrounds] = useState(() => readDisplaySettings().featureBackgrounds);
  useEffect(() => {
    const settings = readDisplaySettings();
    setShowExcerpts(settings.excerpts);
    setShowTags(settings.tags);
    setShowFeatureBackgrounds(settings.featureBackgrounds);
  }, [displayStorageKey]);
  useEffect(() => {
    writeDisplaySettings({ excerpts: showExcerpts });
  }, [showExcerpts, displayStorageKey]);
  useEffect(() => {
    writeDisplaySettings({ tags: showTags });
  }, [showTags, displayStorageKey]);
  useEffect(() => {
    writeDisplaySettings({ featureBackgrounds: showFeatureBackgrounds });
  }, [showFeatureBackgrounds, displayStorageKey]);
  const [postTagMap, setPostTagMap] = useState({});
  const [postDetailMap, setPostDetailMap] = useState({});

  useEffect(() => {
    setPostTagMap({});
    setPostDetailMap({});
  }, [service, creatorId]);
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchCapped, setSearchCapped] = useState(false);
  const [searchMatchSources, setSearchMatchSources] = useState({ text: false, tags: false });
  const filterStorageKey = `kemono.filterFields.${service}.${creatorId}`;
  const reversePrefKey = useMemo(
    () => getCreatorScopedStorageKey("kemono.reverseOrder", service, creatorId, alreadySaved),
    [service, creatorId, alreadySaved],
  );
  const [reverseOrder, setReverseOrder] = useState(() =>
    reversePrefKey ? readBooleanPreference(reversePrefKey, false) : false,
  );
  const handleCachePersistenceFailure = useCallback(() => {
    setCacheStorageError(true);
    setUseCache(false);
    setCacheData(null);
    void writeCreatorCacheAsync(service, creatorId, null);
  }, [service, creatorId]);

  const updateCache = useCallback(
    (updater, { updateTimestamp = true } = {}) => {
      let resolvedNext = null;
      setCacheData((prev) => {
        const base = prev && prev.version === CACHE_VERSION ? prev : { version: CACHE_VERSION };
        const nextBase = typeof updater === "function" ? updater(base) : updater;
        if (!nextBase) {
          resolvedNext = null;
          return null;
        }
        const next = { ...base, ...nextBase, version: CACHE_VERSION };
        if (updateTimestamp) {
          next.updatedAt = Date.now();
        } else if (typeof next.updatedAt !== "number") {
          next.updatedAt = base.updatedAt ?? Date.now();
        }
        if (next.chunks) {
          next.chunks = pruneCacheChunks(next.chunks);
        }
        if (next.postDetails) {
          next.postDetails = pruneCachePostDetails(next.postDetails);
        }
        resolvedNext = next;
        return next;
      });
      void writeCreatorCacheAsync(service, creatorId, resolvedNext).then((success) => {
        if (!success) {
          handleCachePersistenceFailure();
        }
      });
    },
    [service, creatorId, handleCachePersistenceFailure],
  );
  const getDefaultFilterFields = () => ({ title: true, tags: true, body: true });
  const loadStoredFilterFields = () => {
    if (typeof window === "undefined" || !window.localStorage) return getDefaultFilterFields();
    try {
      const stored = window.localStorage.getItem(filterStorageKey);
      if (!stored) return getDefaultFilterFields();
      const parsed = JSON.parse(stored);
      return {
        title: parsed?.title !== undefined ? Boolean(parsed.title) : true,
        tags: parsed?.tags !== undefined ? Boolean(parsed.tags) : true,
        body: parsed?.body !== undefined ? Boolean(parsed.body) : true,
      };
    } catch {
      return getDefaultFilterFields();
    }
  };
  const [filterFields, setFilterFields] = useState(loadStoredFilterFields);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [compactPagination, setCompactPagination] = useState(false);
  const searchTokenRef = useRef(0);
  const searchAbortRef = useRef(null);
  const pendingTagFetchRef = useRef(new Set());
  const prevFilterStorageKeyRef = useRef(filterStorageKey);
  const featureVisibilityObserverRef = useRef(null);
  const featureVisibleKeysRef = useRef(new Set());
  const postListRef = useRef(null);
  const [visibleFeatureKeys, setVisibleFeatureKeys] = useState(() => new Set());
  const [virtualWindow, setVirtualWindow] = useState({
    startRow: 0,
    endRow: 0,
    columns: 1,
    rowHeight: resolveVirtualRowHeight({
      showExcerpts: false,
      showTags: false,
      showFeatureBackgrounds: false,
    }),
  });
  const cacheFresh = useCache && cacheData ? isCacheFresh(cacheData) : false;
  const reloadRequested = cacheReloadApplied !== reloadKey;
  const wantsCacheValidation = Boolean(useCache && cacheData && (reloadRequested || !cacheFresh));
  const cacheValidationPending = wantsCacheValidation && cacheValidationState === "pending";
  const canUseCacheUi = alreadySaved;
  const resolvedProfileCount = toNumericCount(profile?.post_count);
  const resolvedCacheCount = toNumericCount(cacheData?.totalPosts);
  const totalPosts = resolvedProfileCount ?? resolvedCacheCount ?? null;
  const normalizedFilter = typeof activeFilter === "string" ? activeFilter.trim() : "";
  const isFilterActive = normalizedFilter.length > 0;
  const activeTags = useMemo(
    () => (filterFields.tags ? extractTagTokens(normalizedFilter) : []),
    [filterFields.tags, normalizedFilter],
  );
  const effectiveLimit = limit > 0 ? limit : API_PAGE_SIZE;
  const totalFilteredPosts = searchResults.length;
  const filteredTotalPages = isFilterActive
    ? Math.max(1, Math.ceil(Math.max(totalFilteredPosts, 1) / effectiveLimit))
    : 1;
  const clampedSearchPage = isFilterActive ? Math.min(Math.max(searchPage, 1), filteredTotalPages) : 1;
  const pageStart = isFilterActive ? Math.max(0, (clampedSearchPage - 1) * effectiveLimit) : 0;
  const baseSearchResults = useMemo(
    () => (reverseOrder ? [...searchResults].reverse() : searchResults),
    [reverseOrder, searchResults],
  );
  const displayedPosts = useMemo(
    () => (isFilterActive ? baseSearchResults.slice(pageStart, pageStart + effectiveLimit) : posts),
    [isFilterActive, baseSearchResults, pageStart, effectiveLimit, posts],
  );
  const listLoading = isFilterActive ? searchLoading && displayedPosts.length === 0 : loadingPosts;
  const orderedPosts = useMemo(
    () => (!isFilterActive && reverseOrder ? [...displayedPosts].reverse() : displayedPosts),
    [isFilterActive, reverseOrder, displayedPosts],
  );
  const virtualizationActive = orderedPosts.length > VIRTUALIZATION_MIN_ITEMS;
  const virtualizedPosts = useMemo(() => {
    if (!virtualizationActive) {
      return {
        items: orderedPosts,
        startIndex: 0,
        topSpacer: 0,
        bottomSpacer: 0,
      };
    }

    const columns = Math.max(1, virtualWindow.columns || 1);
    const rowHeight = Math.max(1, virtualWindow.rowHeight || resolveVirtualRowHeight({
      showExcerpts,
      showTags,
      showFeatureBackgrounds,
    }));
    const totalRows = Math.ceil(orderedPosts.length / columns);
    if (totalRows <= 0) {
      return {
        items: [],
        startIndex: 0,
        topSpacer: 0,
        bottomSpacer: 0,
      };
    }

    const startRow = Math.min(Math.max(0, virtualWindow.startRow), totalRows - 1);
    const endRow = Math.min(Math.max(startRow, virtualWindow.endRow), totalRows - 1);
    const startIndex = startRow * columns;
    const endIndex = Math.min(orderedPosts.length, (endRow + 1) * columns);
    return {
      items: orderedPosts.slice(startIndex, endIndex),
      startIndex,
      topSpacer: startRow * rowHeight,
      bottomSpacer: Math.max(0, (totalRows - endRow - 1) * rowHeight),
    };
  }, [
    orderedPosts,
    virtualizationActive,
    virtualWindow.columns,
    virtualWindow.rowHeight,
    virtualWindow.startRow,
    virtualWindow.endRow,
    showExcerpts,
    showTags,
    showFeatureBackgrounds,
  ]);
  const currentFilteredOffset = isFilterActive ? Math.max(0, (clampedSearchPage - 1) * effectiveLimit) : null;
  const cachedPostsForSearch = useMemo(() => collectCachedPosts(cacheData), [cacheData?.chunks]);
  const getInitialCreatorName = () =>
    getSavedCreatorName(service, creatorId) ||
    (typeof creatorName === "string" ? creatorName.trim() : "") ||
    getCachedCreatorName(service, creatorId) ||
    "";
  const [resolvedCreatorName, setResolvedCreatorName] = useState(() => getInitialCreatorName());
  const buildCreatorHref = useCallback(
    (positionValue) =>
      getUrlForView({
        name: "creator",
        service,
        creatorId,
        creatorName: resolvedCreatorName || creatorId,
        position: Math.max(0, Number.isFinite(positionValue) ? Math.floor(positionValue) : 0),
      }),
    [service, creatorId, resolvedCreatorName],
  );

  useEffect(() => {
    setResolvedCreatorName(() => getInitialCreatorName());
  }, [service, creatorId]);


  useEffect(() => {
    let alive = true;
    const nextUseCache = readBooleanPreference(cachePrefKey, false);
    setUseCache(nextUseCache);
    if (nextUseCache) {
      setCacheData(loadCreatorCache(service, creatorId));
      void loadCreatorCacheAsync(service, creatorId).then((storedCache) => {
        if (!alive) return;
        setCacheData(storedCache);
      });
    } else {
      setCacheData(null);
    }
    setCacheReloadApplied(0);
    setReverseOrder(reversePrefKey ? readBooleanPreference(reversePrefKey, false) : false);
    return () => {
      alive = false;
    };
  }, [cachePrefKey, service, creatorId, reversePrefKey]);

  useEffect(() => {
    if (useCache) {
      setCacheStorageError(false);
    }
  }, [useCache]);

  useEffect(() => {
    setCacheStorageError(false);
  }, [service, creatorId]);

  useEffect(() => {
    setCacheValidationState("idle");
  }, [service, creatorId]);

  useEffect(() => {
    if (!useCache) {
      setCacheValidationState("idle");
    }
  }, [useCache]);

  useEffect(() => {
    if (alreadySaved) return;
    purgeCreatorLocalState(service, creatorId);
    setUseCache(false);
    setCacheData(null);
    setCacheStorageError(false);
  }, [alreadySaved, service, creatorId]);


  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!alreadySaved) {
      try {
        window.localStorage.removeItem(cachePrefKey);
      } catch {
        // ignore preference cleanup failures
      }
      return;
    }
    try {
      window.localStorage.setItem(cachePrefKey, useCache ? "true" : "false");
    } catch {
      // ignore preference persistence failures
    }
  }, [useCache, cachePrefKey, alreadySaved]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) return;
    if (!reversePrefKey) return;
    try {
      window.localStorage.setItem(reversePrefKey, reverseOrder ? "true" : "false");
    } catch {
      // ignore persistence failures
    }
  }, [reverseOrder, reversePrefKey]);

  useEffect(() => {
    if (!useCache) return;
    let alive = true;
    setCacheData((prev) => (prev ? prev : loadCreatorCache(service, creatorId)));
    void loadCreatorCacheAsync(service, creatorId).then((storedCache) => {
      if (!alive) return;
      setCacheData((prev) => (prev ? prev : storedCache));
    });
    return () => {
      alive = false;
    };
  }, [useCache, service, creatorId]);

  useEffect(() => {
    if (useCache) return;
    setCacheData(null);
    void writeCreatorCacheAsync(service, creatorId, null);
  }, [useCache, service, creatorId]);

  useEffect(
    () => () => {
      searchTokenRef.current += 1;
    },
    [],
  );


  useEffect(() => {
    setFilterFields((prev) => {
      const stored = loadStoredFilterFields();
      if (
        prev.title === stored.title &&
        prev.tags === stored.tags &&
        prev.body === stored.body
      ) {
        return prev;
      }
      return stored;
    });
  }, [service, creatorId]);

  const positionContextRef = useRef({ service, creatorId, position: initialPosition });

  useEffect(() => {
    const savedName = getSavedCreatorName(service, creatorId);
    const incomingName = typeof creatorName === "string" ? creatorName.trim() : "";
    if (savedName && savedName !== resolvedCreatorName) {
      setResolvedCreatorName(savedName);
      return;
    }
    if (!savedName && incomingName && incomingName !== resolvedCreatorName) {
      setResolvedCreatorName(incomingName);
      return;
    }
    if (!savedName) {
      const cachedName = getCachedCreatorName(service, creatorId);
      if (cachedName && cachedName !== resolvedCreatorName) {
        setResolvedCreatorName(cachedName);
      }
    }
  }, [service, creatorId, creatorName, resolvedCreatorName]);


  const rememberPosition = useCallback(
    (rawPosition, meta = {}) => {
      if (typeof onRememberPosition !== "function") return;
      const resolvedPageSize =
        Number.isFinite(meta.pageSize) && meta.pageSize > 0 ? Math.floor(meta.pageSize) : limit || API_PAGE_SIZE;
      const normalizedIndex = Number.isFinite(rawPosition) && rawPosition >= 0 ? Math.floor(rawPosition) : 0;
      onRememberPosition(normalizedIndex, { ...meta, pageSize: resolvedPageSize });
    },
    [onRememberPosition, limit],
  );

  useEffect(() => {
    let alive = true;
    const cachedProfile = useCache && cacheData?.profile ? cacheData.profile : null;
    if (cachedProfile) {
      setProfile(cachedProfile);
      setLoadingProfile(false);
    } else {
      setLoadingProfile(true);
    }

    const shouldFetch = !useCache || !cachedProfile || !cacheFresh || reloadRequested;

    if (!shouldFetch) {
      setCacheValidationState((prev) => (prev === "idle" ? prev : "idle"));
      return () => {
        alive = false;
      };
    }

    if (wantsCacheValidation) {
      setCacheValidationState("pending");
    }

    setLoadingProfile(true);
    fetchJson(`${API_BASE}/${service}/user/${creatorId}/profile`)
      .then((data) => {
        if (!alive) return;
        setProfile(data);
        setLoadingProfile(false);
        if (useCache) {
          if (data) {
            const numericCount = toNumericCount(data?.post_count);
            const cachedCount = toNumericCount(cacheData?.totalPosts ?? cachedProfile?.post_count);
            const countsComparable = typeof numericCount === "number" && typeof cachedCount === "number";
            const countsMatch = countsComparable && numericCount === cachedCount;
            updateCache(
              (prev) => ({
                ...prev,
                profile: data,
                totalPosts: numericCount ?? prev.totalPosts,
              }),
              { updateTimestamp: !wantsCacheValidation || countsMatch },
            );
            if (wantsCacheValidation) {
              if (countsMatch) {
                setCacheReloadApplied(reloadKey);
                setCacheValidationState("validated");
              } else {
                setCacheValidationState("stale");
              }
            } else {
              setCacheValidationState((prev) => (prev === "idle" ? prev : "idle"));
            }
          } else if (wantsCacheValidation) {
            setCacheValidationState("stale");
          }
        } else {
          setCacheValidationState((prev) => (prev === "idle" ? prev : "idle"));
        }
      })
      .catch((error) => {
        console.error("Failed to load profile", error);
        if (!alive) return;
        setLoadingProfile(false);
        if (wantsCacheValidation) {
          setCacheValidationState("error");
        } else {
          setCacheValidationState((prev) => (prev === "idle" ? prev : "idle"));
        }
      });
    return () => {
      alive = false;
    };
  }, [service, creatorId, useCache, cacheData, cacheFresh, reloadRequested, wantsCacheValidation, reloadKey, updateCache]);

  useEffect(() => {
    if (!profile) return;
    if (getSavedCreatorName(service, creatorId)) return;
    const profileName = resolveProfileDisplayName(profile);
    if (profileName && profileName !== resolvedCreatorName) {
      setResolvedCreatorName(profileName);
      cacheCreatorName(service, creatorId, profileName);
    }
  }, [profile, service, creatorId, resolvedCreatorName]);

  useEffect(() => {
    if (!resolvedCreatorName) return;
    cacheCreatorName(service, creatorId, resolvedCreatorName);
  }, [resolvedCreatorName, service, creatorId]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) return;
    const storageKeyChanged = prevFilterStorageKeyRef.current !== filterStorageKey;
    if (storageKeyChanged) {
      prevFilterStorageKeyRef.current = filterStorageKey;
      if (!alreadySaved) {
        try {
          window.localStorage.removeItem(filterStorageKey);
        } catch {
          // ignore cleanup errors
        }
      }
      return;
    }
    prevFilterStorageKeyRef.current = filterStorageKey;
    if (!alreadySaved) {
      try {
        window.localStorage.removeItem(filterStorageKey);
      } catch {
        // ignore cleanup errors
      }
      return;
    }
    const storedSnapshot = loadStoredFilterFields();
    if (
      storedSnapshot.title === filterFields.title &&
      storedSnapshot.tags === filterFields.tags &&
      storedSnapshot.body === filterFields.body
    ) {
      return;
    }
    try {
      window.localStorage.setItem(filterStorageKey, JSON.stringify(filterFields));
    } catch {
      // ignore persistence failures
    }
  }, [filterStorageKey, filterFields, alreadySaved]);

  useEffect(() => {
    const trimmed = typeof activeFilter === "string" ? activeFilter.trim() : "";
    if (!trimmed) return;
    setSearchPage(1);
    setSearchCapped(false);
    runSearch({ query: trimmed });
  }, [filterFields.title, filterFields.tags, filterFields.body, activeFilter, effectiveLimit]);


  useEffect(() => {
    const trimmedFilter = typeof activeFilter === "string" ? activeFilter.trim() : "";
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }
    setSearchInput(trimmedFilter);
    searchTokenRef.current += 1;
    setSearchPage(1);
    if (!trimmedFilter) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchCapped(false);
      return;
    }
    setOffset((value) => (value !== 0 ? 0 : value));
    setSearchResults([]);
    setSearchCapped(false);
    runSearch({ query: trimmedFilter });
  }, [service, creatorId, activeFilter, reloadKey]);

  useEffect(
    () => () => {
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
        searchAbortRef.current = null;
      }
    },
    [],
  );

  const runSearch = async ({ query } = {}) => {
    const trimmed = (query || "").trim();

    const normalizedFields = {
      title: Boolean(filterFields.title),
      tags: Boolean(filterFields.tags),
      body: Boolean(filterFields.body),
    };
    if (!normalizedFields.title && !normalizedFields.tags && !normalizedFields.body) {
      normalizedFields.title = true;
      normalizedFields.tags = true;
      normalizedFields.body = true;
      setFilterFields({ ...normalizedFields });
    }

    const tagTokens = normalizedFields.tags ? extractTagTokens(trimmed) : [];
    const hasTagSearch = normalizedFields.tags && tagTokens.length > 0;
    const textSearchable = normalizedFields.title || normalizedFields.body;
    const normalizedTextQuery = textSearchable ? trimmed.replace(/,/g, " ").trim() : "";
    const textTokens = normalizedTextQuery
      ? normalizedTextQuery
          .toLowerCase()
          .split(/\s+/)
          .map((token) => token.trim())
          .filter(Boolean)
      : [];
    const hasTextSearch = textSearchable && textTokens.length > 0;

    if (!hasTextSearch && !hasTagSearch) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchCapped(false);
      setSearchMatchSources({ text: false, tags: false });
      return;
    }

    let matchedViaText = false;
    let matchedViaTags = false;

    if (useCache && cacheFresh) {
      if (cachedPostsForSearch && cachedPostsForSearch.length > 0) {
        const results = cachedPostsForSearch.filter((post) => {
          if (!post) return false;
          let matchesTags = false;
          if (hasTagSearch) {
            const postTags = Array.isArray(post.tags)
              ? post.tags.map((tag) => String(tag).toLowerCase())
              : [];
            matchesTags = tagTokens.every((token) => postTags.includes(token));
            if (matchesTags) matchedViaTags = true;
          }
          let matchesText = false;
          if (hasTextSearch) {
            matchesText = postMatchesTextTokens(post, textTokens, normalizedFields);
            if (matchesText) matchedViaText = true;
          }
          if (hasTagSearch && hasTextSearch) {
            return matchesTags || matchesText;
          }
          if (hasTagSearch) return matchesTags;
          return matchesText;
        });
        const cacheTotalPosts = toNumericCount(cacheData?.totalPosts);
        const cacheComplete =
          typeof cacheTotalPosts === "number" &&
          cacheTotalPosts > 0 &&
          cacheTotalPosts <= MAX_CACHE_POSTS &&
          cachedPostsForSearch.length >= cacheTotalPosts;
        const capped = Boolean(cacheTotalPosts && cacheTotalPosts > cachedPostsForSearch.length);
        if (results.length > 0 || cacheComplete) {
          setSearchResults(dedupePostsById(results));
          setSearchCapped(capped);
          setSearchLoading(false);
          setSearchMatchSources({
            text: hasTextSearch && matchedViaText,
            tags: hasTagSearch && matchedViaTags,
          });
          return;
        }
        // Fall through to API search when cache did not yield any hits and we cannot prove completeness.
      }
    }

    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const requestController = typeof AbortController !== "undefined" ? new AbortController() : null;
    searchAbortRef.current = requestController;
    const requestSignal = requestController?.signal;

    const token = (searchTokenRef.current += 1);
    const encodedQuery = hasTextSearch ? encodeURIComponent(normalizedTextQuery) : "";
    const filterBody = normalizedFields.body ? "true" : "false";
    const filterTitle = normalizedFields.title ? "true" : "false";
    const filterTags = normalizedFields.tags ? "true" : "false";
    const fieldParams = `&title=${filterTitle}&tags=${filterTags}&body=${filterBody}`;
    const tagFieldParams = normalizedFields.body
      ? fieldParams
      : `&title=${filterTitle}&tags=${filterTags}&body=true`;
    const tagParams = hasTagSearch ? tagTokens.map((tag) => `&tag=${encodeURIComponent(tag)}`).join("") : "";

    const searchModes = [];
    if (hasTextSearch) {
      searchModes.push({
        type: "text",
        queryParam: `&q=${encodedQuery}`,
        tagParam: "",
        fieldParam: fieldParams,
        allowCache: true,
      });
    }
    if (hasTagSearch) {
      searchModes.push({
        type: "tags",
        queryParam: "",
        tagParam: tagParams,
        fieldParam: tagFieldParams,
        allowCache: !hasTextSearch,
      });
    }

    setSearchLoading(true);
    setSearchResults([]);
    setSearchCapped(false);
    setSearchMatchSources({ text: false, tags: false });

    const seenIds = new Set();
    const workingResults = [];
    let capped = false;

    try {
      for (const mode of searchModes) {
        let offset = 0;
        let exhausted = false;
        const needsTextFiltering = mode.type === "text" && hasTextSearch;
        while (!exhausted && workingResults.length < MAX_SEARCH_RESULTS) {
          const chunk = await fetchJson(
            `${API_BASE}/${service}/user/${creatorId}/posts?o=${offset}&n=${API_PAGE_SIZE}${mode.queryParam}${mode.fieldParam}${mode.tagParam}`,
            { signal: requestSignal, dedupe: false },
          );
          if (requestSignal?.aborted || token !== searchTokenRef.current) return;
          if (!Array.isArray(chunk) || chunk.length === 0) {
            exhausted = true;
            break;
          }
          let chunkMatchedViaText = false;
          let chunkMatchedViaTags = false;
          if (useCache && mode.allowCache && chunk.length > 0) {
            updateCache((prev) => {
              const prevChunks = prev?.chunks ? { ...prev.chunks } : {};
              prevChunks[String(offset)] = chunk.slice();
              return {
                ...prev,
                chunks: pruneCacheChunks(prevChunks),
              };
            });
          }
          chunk.forEach((post) => {
            if (!post) return;
            if (needsTextFiltering && !postMatchesTextTokens(post, textTokens, normalizedFields)) {
              return;
            }
            const key = post.id != null ? String(post.id) : null;
            if (key && seenIds.has(key)) return;
            if (key) {
              seenIds.add(key);
            }
            workingResults.push(post);
            if (needsTextFiltering) {
              chunkMatchedViaText = true;
            }
            if (mode.type === "tags") {
              chunkMatchedViaTags = true;
            }
          });
          if (chunkMatchedViaText) {
            matchedViaText = true;
          }
          if (chunkMatchedViaTags) {
            matchedViaTags = true;
          }
          offset += API_PAGE_SIZE;
          if (chunk.length < API_PAGE_SIZE) {
            exhausted = true;
          }
          if (workingResults.length >= MAX_SEARCH_RESULTS) {
            capped = true;
            break;
          }
        }
        if (workingResults.length >= MAX_SEARCH_RESULTS) break;
      }

      if (token !== searchTokenRef.current) return;

      setSearchResults(dedupePostsById(workingResults));
      setSearchCapped(capped);
      setSearchMatchSources({
        text: hasTextSearch && matchedViaText,
        tags: hasTagSearch && matchedViaTags,
      });
    } catch (error) {
      if (!requestSignal?.aborted) {
        console.error("Post search failed", error);
      }
      if (token !== searchTokenRef.current) return;
      setSearchResults([]);
      setSearchCapped(false);
      setSearchMatchSources({ text: false, tags: false });
    } finally {
      if (searchAbortRef.current === requestController) {
        searchAbortRef.current = null;
      }
      if (token === searchTokenRef.current && !requestSignal?.aborted) {
        setSearchLoading(false);
      }
    }
  };
  const collectTextSearchHaystacks = (post, fields) => {
    const haystacks = [];
    if (!post || !fields) return haystacks;
    if (fields.title) {
      if (typeof post.title === "string") {
        haystacks.push(post.title);
      }
      if (typeof post.id === "string") {
        haystacks.push(post.id);
      }
    }
    if (fields.body) {
      const bodyCandidates = [
        post.excerpt,
        post.snippet,
        post.summary,
        post.match,
        post.content,
        post.body,
        post.text,
        post.description,
      ];
      bodyCandidates.forEach((candidate) => {
        if (!candidate) return;
        if (typeof candidate === "string") {
          haystacks.push(candidate);
        } else if (typeof candidate === "object") {
          Object.values(candidate).forEach((value) => {
            if (typeof value === "string") {
              haystacks.push(value);
            }
          });
        }
      });
    }
    return haystacks;
  };
  const postMatchesTextTokens = (post, tokens, fields) => {
    if (!post || !Array.isArray(tokens) || tokens.length === 0 || !fields) return false;
    const haystacks = collectTextSearchHaystacks(post, fields);
    if (!haystacks.length) return false;
    const normalizedHaystacks = haystacks
      .map((value) => (typeof value === "string" ? value.toLowerCase() : null))
      .filter(Boolean);
    if (!normalizedHaystacks.length) return false;
    return tokens.every((token) => normalizedHaystacks.some((hay) => hay.includes(token)));
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    const trimmed = searchInput.trim();
    setSearchInput(trimmed);
    const currentFilter = typeof activeFilter === "string" ? activeFilter.trim() : "";
    const tagTokens = filterFields.tags ? extractTagTokens(trimmed) : [];
    const hasTags = tagTokens.length > 0;
    const hasQuery = trimmed.replace(/,/g, " ").trim().length > 0;

    if (!hasQuery && !hasTags) {
      handleSearchClear();
      return;
    }

    if (trimmed === currentFilter) {
      setSearchPage(1);
      setSearchCapped(false);
      runSearch({ query: trimmed });
      return;
    }

    onUpdateFilter(trimmed);
  };

  const updateFilterField = (field, checked) => {
    setFilterFields((prev) => {
      if (prev[field] === checked) return prev;
      const next = { ...prev, [field]: checked };
      if (!next.title && !next.tags && !next.body) {
        return { ...next, [field]: true };
      }
      return next;
    });
  };

  const handleSearchClear = () => {
    onUpdateFilter("");
    setSearchInput("");
    setSearchPage(1);
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(filterStorageKey);
    }
    setFilterFields(getDefaultFilterFields());
    setSearchMatchSources({ text: false, tags: false });
  };

  useEffect(() => {
    const trimmedFilter = typeof activeFilter === "string" ? activeFilter.trim() : "";
    if (trimmedFilter) {
      setPosts([]);
      setHasNextPage(false);
      setLoadingPosts(false);
      return;
    }

    let alive = true;
    const baseRequested = limit > 0 ? limit : API_PAGE_SIZE;
    const canReverseChunks = reverseOrder && typeof totalPosts === "number" && totalPosts > 0;
    let requested = baseRequested;
    let start = offset;

    if (canReverseChunks) {
      const remaining = Math.max(0, totalPosts - offset);
      if (remaining > 0) {
        requested = Math.min(baseRequested, remaining);
        start = Math.max(0, totalPosts - offset - requested);
      } else {
        requested = 0;
        start = 0;
      }
    }

    const chunkOffsets = (() => {
      if (requested <= 0) return [Math.floor(offset / API_PAGE_SIZE) * API_PAGE_SIZE];
      const firstChunkOffset = Math.floor(start / API_PAGE_SIZE) * API_PAGE_SIZE;
      const lastIndexNeeded = Math.max(start, start + requested - 1);
      const lastChunkOffset = Math.floor(lastIndexNeeded / API_PAGE_SIZE) * API_PAGE_SIZE;
      const offsets = [];
      for (let current = firstChunkOffset; current <= lastChunkOffset; current += API_PAGE_SIZE) {
        offsets.push(current);
      }
      if (offsets.length === 0) offsets.push(firstChunkOffset);
      return offsets;
    })();

    const cachedChunks = useCache && cacheData?.chunks ? cacheData.chunks : null;
    const responsesFromCache = cachedChunks ? chunkOffsets.map((chunkOffset) => cachedChunks[String(chunkOffset)]) : [];
    const allChunksCached =
      useCache && cachedChunks ? responsesFromCache.every((chunk) => Array.isArray(chunk)) : false;

    const sliceFromResponses = (responses) => {
      const combined = [];
      responses.forEach((data, responseIndex) => {
        if (!Array.isArray(data) || data.length === 0) return;
        const chunkOffset = chunkOffsets[responseIndex] ?? 0;
        data.forEach((item, idx) => {
          const existingIndex = combined.findIndex((entry) => entry?.id && entry.id === item?.id);
          const annotated =
            item && typeof item === "object"
              ? { ...item, __position: chunkOffset + idx }
              : item;
          if (existingIndex === -1) {
            combined.push(annotated);
          } else {
            combined[existingIndex] = annotated;
          }
        });
      });
      const dedupeSlice = (list) => {
        const seen = new Set();
        const result = [];
        list.forEach((item, idx) => {
          const key =
            item && item.id != null
              ? String(item.id)
              : `idx-${chunkOffsets[0] ?? 0}-${idx}`;
          if (seen.has(key)) return;
          seen.add(key);
          result.push(item);
        });
        return result;
      };

      if (requested <= 0) {
        return {
          combined,
          slice: dedupeSlice(
            combined
              .filter((item) => typeof item !== "object" || typeof item.__position === "number")
              .map((item) => ({ ...item })),
          ),
          hasMore: false,
        };
      }
      const sliceStart = Math.max(0, start - (chunkOffsets[0] ?? 0));
      const slice = combined.slice(sliceStart, sliceStart + requested);
      const annotatedSlice = slice.map((item, index) => {
        if (item && typeof item === "object") {
          const existingPosition =
            typeof item.__position === "number"
              ? item.__position
              : (chunkOffsets[0] ?? 0) + sliceStart + index;
          return { ...item, __position: existingPosition };
        }
        return item;
      });
      const deduped = dedupeSlice(annotatedSlice);
      const totalKnown = typeof totalPosts === "number" ? totalPosts : null;
      const lastResponse = responses[responses.length - 1];
      const lastChunkLength = Array.isArray(lastResponse) ? lastResponse.length : 0;
      const availableFromStart = Math.max(0, combined.length - sliceStart);
      const hasMore =
        typeof totalKnown === "number"
          ? start + deduped.length < totalKnown
          : availableFromStart > deduped.length || lastChunkLength === API_PAGE_SIZE;
      return { combined, slice: deduped, hasMore };
    };

    let cachedSliceResult = null;
    if (allChunksCached) {
      cachedSliceResult = sliceFromResponses(responsesFromCache);
      setPosts(cachedSliceResult.slice);
      setHasNextPage(cachedSliceResult.hasMore);
      if ((cacheFresh && !reloadRequested) || cacheValidationPending) {
        setLoadingPosts(false);
        return () => {
          alive = false;
        };
      }
      // continue to refresh cache if requested
    }

    if (cachedSliceResult && cacheValidationState === "error") {
      setLoadingPosts(false);
      return () => {
        alive = false;
      };
    }

    const shouldBypassCache = !useCache || !cacheFresh || reloadRequested;
    const offsetsToFetch = shouldBypassCache
      ? chunkOffsets
      : chunkOffsets.filter((chunkOffset) => !Array.isArray(cachedChunks?.[String(chunkOffset)]));

    if (offsetsToFetch.length === 0 && allChunksCached) {
      setLoadingPosts(false);
      return () => {
        alive = false;
      };
    }

    setLoadingPosts(true);

    const fetchPromises = offsetsToFetch.map((chunkOffset) =>
      fetchJson(`${API_BASE}/${service}/user/${creatorId}/posts?o=${chunkOffset}&n=${API_PAGE_SIZE}`).then(
        (data) => ({ offset: chunkOffset, data }),
      ),
    );

    Promise.all(fetchPromises)
      .then((fetchedChunks) => {
        if (!alive) return;
        const mergedChunks = { ...(cachedChunks || {}) };
        fetchedChunks.forEach(({ offset, data }) => {
          mergedChunks[String(offset)] = Array.isArray(data) ? data : [];
        });
        const responses = chunkOffsets.map((chunkOffset) => mergedChunks[String(chunkOffset)] ?? []);
        const { slice, hasMore } = sliceFromResponses(responses);
        setPosts(slice);
        setHasNextPage(hasMore);
        setLoadingPosts(false);
        if (useCache) {
          const profileCount = toNumericCount(profile?.post_count);
          const cacheCount = toNumericCount(cacheData?.totalPosts);
          updateCache((prev) => ({
            ...prev,
            chunks: mergedChunks,
            totalPosts: profileCount ?? cacheCount ?? prev.totalPosts ?? null,
          }));
          setCacheReloadApplied(reloadKey);
          setCacheValidationState((prev) => (prev === "idle" ? prev : "idle"));
        }
      })
      .catch((error) => {
        console.error("Failed to load posts", error);
        if (!alive) return;
        const hadCachedPosts = Boolean(cachedSliceResult && cachedSliceResult.slice.length > 0);
        if (!hadCachedPosts) {
          setPosts((prev) => (Array.isArray(prev) && prev.length > 0 ? prev : []));
          setHasNextPage(false);
        }
        setLoadingPosts(false);
      });

    return () => {
      alive = false;
    };
  }, [
    service,
    creatorId,
    offset,
    limit,
    reloadKey,
    activeFilter,
    useCache,
    cacheData,
    cacheFresh,
    reloadRequested,
    totalPosts,
    reverseOrder,
    updateCache,
    cacheValidationPending,
    cacheValidationState,
  ]);

  const cacheUpdatedAt = useCache && cacheData?.updatedAt ? cacheData.updatedAt : null;
  const cacheUpdatedStamp = cacheUpdatedAt ? formatDate(cacheUpdatedAt) : null;
  const cacheUpdatedLabel = cacheUpdatedStamp
    ? `${cacheUpdatedStamp.date}${cacheUpdatedStamp.time ? ` ${cacheUpdatedStamp.time}` : ""}`
    : null;
  const cacheStatusMessage = (() => {
    if (cacheStorageError) {
      return "Cache unavailable (storage full)";
    }
    if (!useCache) {
      return null;
    }
    if (cacheValidationPending) {
      return "Checking for new posts...";
    }
    if (cacheValidationState === "error") {
      return "API unavailable. Showing saved posts.";
    }
    if (cacheValidationState === "stale" || !cacheFresh) {
      return "Refreshing posts from source...";
    }
    if (cacheFresh && cacheUpdatedLabel) {
      return `Cached locally - updated ${cacheUpdatedLabel}`;
    }
    return cacheUpdatedLabel ? `Cached locally - updated ${cacheUpdatedLabel}` : "Cache ready";
  })();

  useEffect(() => {
    if (!isFilterActive) return;
    if (!searchResults.length) return;
    if (searchPage === clampedSearchPage) return;
    setSearchPage(clampedSearchPage);
  }, [isFilterActive, searchResults.length, clampedSearchPage, searchPage]);

  useEffect(() => {
    if (!isFilterActive) return;
    const desiredPage =
      Number.isFinite(initialPosition) && initialPosition > 0
        ? Math.min(
            Math.max(Math.floor(initialPosition / effectiveLimit) + 1, 1),
            Number.isFinite(filteredTotalPages) ? filteredTotalPages : Math.floor(initialPosition / effectiveLimit) + 1,
          )
        : 1;
    if (desiredPage && desiredPage !== searchPage) {
      setSearchPage(desiredPage);
    }
  }, [isFilterActive, initialPosition, effectiveLimit, filteredTotalPages, searchPage]);

  useEffect(() => {
    if (!showTags && !showExcerpts) return;
    const targetPosts = isFilterActive ? displayedPosts : posts;
    if (!targetPosts.length) return;

    const cachedDetails = useCache && cacheData?.postDetails ? cacheData.postDetails : null;
    const missingRequirements = new Map();
    const pending = pendingTagFetchRef.current;
    const cachedTagUpdates = {};
    const cachedDetailUpdates = {};
    const missing = [];

    targetPosts.forEach((post) => {
      if (pending.has(post.id)) return;
      const needsTags =
        showTags && !Array.isArray(post.tags) && !Array.isArray(postTagMap[post.id]);
      const existingExcerpt = showExcerpts ? getPostExcerptHtml(postDetailMap[post.id] || post) : null;
      const needsExcerpt = showExcerpts && !existingExcerpt;
      if (!needsTags && !needsExcerpt) return;
      const cachedDetailEntry = cachedDetails?.[post.id];
      const cachedEntry = cachedDetailEntry?.data;
      const hydrated = Boolean(cachedDetailEntry?.hydrated);
      let shouldFetch = false;
      if (!cachedEntry) {
        shouldFetch = true;
      } else {
        if (needsTags) {
          if (Array.isArray(cachedEntry?.tags)) {
            const cachedTags = cachedEntry.tags.map((tag) => String(tag));
            cachedTagUpdates[post.id] = cachedTags;
          } else if (!hydrated) {
            shouldFetch = true;
          }
        }
        if (needsExcerpt) {
          const cachedExcerpt = getPostExcerptHtml(cachedEntry);
          if (cachedExcerpt) {
            cachedDetailUpdates[post.id] = cachedEntry;
          } else if (!hydrated) {
            shouldFetch = true;
          }
        }
      }
      if (shouldFetch) {
        missing.push(post);
        missingRequirements.set(post.id, { needsTags, needsExcerpt });
      }
    });

    const cachedIds = Object.keys(cachedTagUpdates);
    if (cachedIds.length > 0) {
      setPostTagMap((prev) => {
        let changed = false;
        const next = { ...prev };
        cachedIds.forEach((postId) => {
          const nextTags = cachedTagUpdates[postId];
          const previous = next[postId];
          const differs =
            !Array.isArray(previous) ||
            previous.length !== nextTags.length ||
            previous.some((value, index) => value !== nextTags[index]);
          if (differs) {
            next[postId] = nextTags;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }

    const cachedDetailIds = Object.keys(cachedDetailUpdates);
    if (cachedDetailIds.length > 0) {
      setPostDetailMap((prev) => {
        let changed = false;
        const next = { ...prev };
        cachedDetailIds.forEach((postId) => {
          const detail = cachedDetailUpdates[postId];
          if (detail && next[postId] !== detail) {
            next[postId] = detail;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }

    if (missing.length === 0) return;

    missing.forEach((post) => pending.add(post.id));

    let alive = true;

    (async () => {
      const aggregatedResults = [];

      if (isFilterActive) {
        const detailResponses = await Promise.all(
          missing.map(async (post) => {
            try {
              const payload = await fetchJson(`${API_BASE}/${service}/user/${creatorId}/post/${post.id}`);
              const detail = payload?.post || payload || null;
              return {
                id: post.id,
                tags: Array.isArray(detail?.tags) ? detail.tags.map((tag) => String(tag)) : [],
                postData: detail,
              };
            } catch (error) {
              console.error("Failed to load detailed post content", post.id, error);
              return { id: post.id, tags: [], postData: null };
            }
          }),
        );
        aggregatedResults.push(...detailResponses);
        if (!alive || aggregatedResults.length === 0) return;
      } else {
        const chunkSize = 50;
        const queue = [...missing];
        while (queue.length > 0) {
          const batch = queue.splice(0, chunkSize);
          const startOffset = Number.isFinite(batch[0]?.__position)
            ? Math.floor(batch[0].__position / API_PAGE_SIZE) * API_PAGE_SIZE
            : 0;
          const needRangeStart = Math.max(0, Math.min(...batch.map((post) => Math.max(0, post.__position ?? 0))));
          const needRangeEnd = Math.max(
            ...batch.map((post, idx) => Math.max(needRangeStart, (post.__position ?? idx) + 1)),
          );
          const sliceSize = Math.max(API_PAGE_SIZE, needRangeEnd - needRangeStart + API_PAGE_SIZE);
          try {
            const chunk = await fetchJson(
              `${API_BASE}/${service}/user/${creatorId}/posts?o=${Math.max(
                0,
                Math.floor(needRangeStart / API_PAGE_SIZE) * API_PAGE_SIZE,
              )}&n=${sliceSize}`,
            );
            if (Array.isArray(chunk)) {
              aggregatedResults.push(
                ...batch.map((post) => {
                  const found = chunk.find((entry) => entry && entry.id === post.id);
                  return {
                    id: post.id,
                    tags: Array.isArray(found?.tags) ? found.tags.map((tag) => String(tag)) : [],
                    postData: found || null,
                  };
                }),
              );
            }
          } catch (error) {
            console.error("Failed to load post details", error);
            aggregatedResults.push(
              ...batch.map((post) => ({ id: post.id, tags: [], postData: null })),
            );
          }
        }
        if (!alive || aggregatedResults.length === 0) return;

        const detailTargets = aggregatedResults
          .filter(({ id, postData }) => {
            const requirements = missingRequirements.get(id);
            if (!postData) return true;
            const needsTags = Boolean(requirements?.needsTags);
            const needsExcerpt = Boolean(requirements?.needsExcerpt);
            const hasTags = !needsTags || Array.isArray(postData.tags);
            const hasExcerpt = !needsExcerpt || Boolean(getPostExcerptHtml(postData));
            return !hasTags || !hasExcerpt;
          })
          .map((entry) => entry.id);

        if (alive && detailTargets.length > 0) {
          const detailResponses = await Promise.all(
            detailTargets.map(async (postId) => {
              try {
                const payload = await fetchJson(`${API_BASE}/${service}/user/${creatorId}/post/${postId}`);
                const detail = payload?.post || payload || null;
                return { postId, detail };
              } catch (error) {
                console.error("Failed to load detailed post content", postId, error);
                return { postId, detail: null };
              }
            }),
          );
          if (!alive) return;
          detailResponses.forEach(({ postId, detail }) => {
            const target = aggregatedResults.find((entry) => entry.id === postId);
            if (!target) return;
            if (detail) {
              target.postData = detail;
              if (Array.isArray(detail.tags)) {
                target.tags = detail.tags.map((tag) => String(tag));
              }
            }
          });
        }
      }

      if (showTags) {
        setPostTagMap((prev) => {
          let changed = false;
          const next = { ...prev };
          aggregatedResults.forEach(({ id, tags }) => {
            const normalized = Array.isArray(tags) ? tags : [];
            const previous = next[id];
            const differs =
              !Array.isArray(previous) ||
              previous.length !== normalized.length ||
              previous.some((value, index) => value !== normalized[index]);
            if (differs) {
              next[id] = normalized;
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }
      if (showExcerpts) {
        setPostDetailMap((prev) => {
          let changed = false;
          const next = { ...prev };
          aggregatedResults.forEach(({ id, postData }) => {
            if (postData && next[id] !== postData) {
              next[id] = postData;
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }
      if (useCache) {
        const detailEntries = aggregatedResults.filter((entry) => entry.postData);
        if (detailEntries.length > 0) {
          const timestamp = Date.now();
          updateCache(
            (prev) => {
              const nextDetails = { ...(prev.postDetails || {}) };
              detailEntries.forEach(({ id, postData }) => {
                nextDetails[id] = { data: postData, updatedAt: timestamp, hydrated: true };
              });
              return { ...prev, postDetails: nextDetails };
            },
            { updateTimestamp: false },
          );
        }
      }
    })().finally(() => {
      missing.forEach((post) => pending.delete(post.id));
    });

    return () => {
      alive = false;
      missing.forEach((post) => pending.delete(post.id));
    };
  }, [
    showTags,
    showExcerpts,
    isFilterActive,
    posts,
    displayedPosts,
    service,
    creatorId,
    postTagMap,
    postDetailMap,
    useCache,
    cacheData,
    updateCache,
  ]);

  const hasPrev = offset > 0;
  const derivedTotalPages =
    typeof totalPosts === "number" && limit > 0 ? Math.max(1, Math.ceil(totalPosts / limit)) : null;
  const currentPage = limit > 0 ? Math.floor(offset / limit) + 1 : 1;
  const hasNext = derivedTotalPages ? offset + limit < totalPosts : hasNextPage;
  const totalPages = derivedTotalPages ?? currentPage + (hasNext ? 1 : 0);
  const avatarUrl = `https://img.kemono.cr/icons/${service}/${creatorId}`;
  const serviceLabel = getServiceLabel(service);
  const normalizedFilterText = normalizedFilter.replace(/,/g, " ").trim();
  const canTextFilter = (filterFields.title || filterFields.body) && normalizedFilterText.length > 0;
  const canTagFilter = filterFields.tags && activeTags.length > 0;
  const tagDescriptor =
    activeTags.length > 0 ? `${activeTags.length} tag${activeTags.length === 1 ? "" : "s"}` : null;
  const filterDescriptor = (() => {
    const textDescriptor = normalizedFilterText ? `"${normalizedFilterText}"` : `"${normalizedFilter}"`;
    const textContributed = Boolean(canTextFilter && searchMatchSources.text);
    const tagsContributed = Boolean(canTagFilter && tagDescriptor && searchMatchSources.tags);
    if (textContributed && tagsContributed) {
      return `${textDescriptor} and ${tagDescriptor}`;
    }
    if (tagsContributed) {
      return tagDescriptor;
    }
    if (textContributed) {
      return textDescriptor;
    }
    if (canTextFilter) {
      return textDescriptor;
    }
    if (canTagFilter && tagDescriptor) {
      return tagDescriptor;
    }
    return textDescriptor;
  })();
  const limitedByResultCap = searchCapped && totalFilteredPosts >= MAX_SEARCH_RESULTS;
  const totalLabel = limitedByResultCap ? `${totalFilteredPosts}+` : `${totalFilteredPosts}`;
  const summaryLabel = isFilterActive
    ? listLoading
      ? `Filtering ${filterDescriptor}...`
      : totalFilteredPosts === 0
        ? `No posts match ${filterDescriptor}.`
        : `${totalLabel} post${totalFilteredPosts === 1 ? "" : "s"} match ${filterDescriptor}${
            limitedByResultCap ? ` (showing first ${MAX_SEARCH_RESULTS})` : ""
          }`
    : loadingPosts
      ? "Loading..."
      : `Showing ${posts.length} items`;

  useEffect(() => {
    const ctx = positionContextRef.current;
    const changed =
      ctx.service !== service || ctx.creatorId !== creatorId || ctx.position !== initialPosition;
    if (!changed) return;
    positionContextRef.current = { service, creatorId, position: initialPosition };
    if (!isFilterActive) {
      setOffset(resolveOffsetForPosition(initialPosition, limit || initialPageSizeRef.current));
    }
  }, [service, creatorId, initialPosition, isFilterActive, limit]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 520px)");
    const handle = () => setCompactPagination(media.matches);
    handle();
    if (media.addEventListener) {
      media.addEventListener("change", handle);
    } else {
      media.addListener(handle);
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener("change", handle);
      } else {
        media.removeListener(handle);
      }
    };
  }, []);

  const updateVirtualWindow = useCallback(() => {
    if (typeof window === "undefined") return;
    const listNode = postListRef.current;
    if (!listNode) return;

    const rowHeight = resolveVirtualRowHeight({
      showExcerpts,
      showTags,
      showFeatureBackgrounds,
    });

    const width = listNode.clientWidth || 0;
    const columns = Math.max(1, Math.floor((width + VIRTUAL_GRID_GAP) / (VIRTUAL_CARD_MIN_WIDTH + VIRTUAL_GRID_GAP)));

    if (!virtualizationActive) {
      const totalRows = Math.max(1, Math.ceil(Math.max(orderedPosts.length, 1) / columns));
      setVirtualWindow({
        startRow: 0,
        endRow: Math.max(0, totalRows - 1),
        columns,
        rowHeight,
      });
      return;
    }

    const totalRows = Math.max(1, Math.ceil(orderedPosts.length / columns));
    const rect = listNode.getBoundingClientRect();
    const listTop = rect.top + window.scrollY;
    const viewportTop = window.scrollY - listTop;
    const viewportBottom = viewportTop + (window.innerHeight || 0);

    const startRow = Math.max(0, Math.floor(viewportTop / rowHeight) - VIRTUAL_OVERSCAN_ROWS);
    const endRow = Math.min(totalRows - 1, Math.ceil(viewportBottom / rowHeight) + VIRTUAL_OVERSCAN_ROWS);

    setVirtualWindow((prev) => {
      if (
        prev.startRow === startRow &&
        prev.endRow === endRow &&
        prev.columns === columns &&
        prev.rowHeight === rowHeight
      ) {
        return prev;
      }
      return { startRow, endRow, columns, rowHeight };
    });
  }, [showExcerpts, showTags, showFeatureBackgrounds, virtualizationActive, orderedPosts.length]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let frameId = 0;
    const scheduleUpdate = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        updateVirtualWindow();
      });
    };

    scheduleUpdate();

    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });

    let observer = null;
    if (typeof window.ResizeObserver !== "undefined" && postListRef.current) {
      observer = new window.ResizeObserver(() => scheduleUpdate());
      observer.observe(postListRef.current);
    }

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate);
      if (observer) {
        observer.disconnect();
      }
    };
  }, [updateVirtualWindow]);

  function goToPage(page) {
    if (!limit) return;
    const nextOffset = Math.max(0, (page - 1) * limit);
    setOffset(nextOffset);
    if (!isFilterActive) {
      rememberPosition(nextOffset, { pageSize: limit });
    }
  }

  const goToSearchPage = (page) => {
    const nextNumeric = Number.isFinite(page) ? Math.trunc(page) : searchPage;
    const next = Math.min(Math.max(nextNumeric || 1, 1), filteredTotalPages || 1);
    if (next === searchPage) return;
    setSearchPage(next);
    if (isFilterActive) {
      rememberPosition(Math.max(0, (next - 1) * effectiveLimit), { pageSize: effectiveLimit });
    }
  };

  const filterHasPrev = isFilterActive ? clampedSearchPage > 1 : false;
  const filterHasNext = isFilterActive ? clampedSearchPage < filteredTotalPages : false;

  const paginationState = isFilterActive
    ? filteredTotalPages > 1
      ? {
          currentPage: clampedSearchPage,
          totalPages: filteredTotalPages,
          hasPrev: filterHasPrev,
          hasNext: filterHasNext,
          goTo: goToSearchPage,
        }
      : null
    : totalPages > 1
      ? {
          currentPage,
          totalPages,
          hasPrev,
          hasNext,
          goTo: goToPage,
        }
      : null;

  const markFeatureCardsVisible = useCallback((keys) => {
    if (!Array.isArray(keys) || keys.length === 0) return;
    let changed = false;
    keys.forEach((key) => {
      if (!key || featureVisibleKeysRef.current.has(key)) return;
      featureVisibleKeysRef.current.add(key);
      changed = true;
    });
    if (changed) {
      setVisibleFeatureKeys(new Set(featureVisibleKeysRef.current));
    }
  }, []);

  useEffect(() => {
    featureVisibleKeysRef.current = new Set();
    setVisibleFeatureKeys(new Set());
    if (featureVisibilityObserverRef.current) {
      featureVisibilityObserverRef.current.disconnect();
      featureVisibilityObserverRef.current = null;
    }
  }, [service, creatorId, showFeatureBackgrounds, isFilterActive, clampedSearchPage, currentPage, reverseOrder]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!showFeatureBackgrounds) return;
    if (!postListRef.current) return;

    const cards = Array.from(postListRef.current.querySelectorAll("[data-feature-key]"));
    if (cards.length === 0) return;

    if (featureVisibilityObserverRef.current) {
      featureVisibilityObserverRef.current.disconnect();
      featureVisibilityObserverRef.current = null;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        const newlyVisible = [];
        entries.forEach((entry) => {
          if (!entry.isIntersecting && entry.intersectionRatio <= 0) return;
          const key = entry.target.getAttribute("data-feature-key");
          if (!key) return;
          newlyVisible.push(key);
          observer.unobserve(entry.target);
        });
        if (newlyVisible.length > 0) {
          markFeatureCardsVisible(newlyVisible);
        }
      },
      {
        root: null,
        rootMargin: "320px 0px",
        threshold: 0.01,
      },
    );

    featureVisibilityObserverRef.current = observer;
    const viewportHeight = window.innerHeight || 0;
    const nearViewport = [];

    cards.forEach((card) => {
      const key = card.getAttribute("data-feature-key");
      if (!key || featureVisibleKeysRef.current.has(key)) return;

      const rect = card.getBoundingClientRect();
      const insidePrefetchBand = rect.bottom >= -320 && rect.top <= viewportHeight + 320;
      if (insidePrefetchBand) {
        nearViewport.push(key);
        return;
      }

      observer.observe(card);
    });

    if (nearViewport.length > 0) {
      markFeatureCardsVisible(nearViewport);
    }

    return () => {
      observer.disconnect();
      if (featureVisibilityObserverRef.current === observer) {
        featureVisibilityObserverRef.current = null;
      }
    };
  }, [showFeatureBackgrounds, markFeatureCardsVisible, virtualizedPosts.items, virtualizedPosts.startIndex]);

  const handleOrderToggle = () => {
    if (isFilterActive) {
      setSearchPage(1);
    } else {
      setOffset(0);
      rememberPosition(0, { pageSize: limit });
    }
    setReverseOrder((prev) => !prev);
  };

  const renderPagination = ({ showMeta = true } = {}) => {
    if (!paginationState) return null;
    if (paginationState.totalPages <= 1) return null;

    const pages = [];

    const maxDirectDisplay = compactPagination ? 5 : 9;
    const windowRadius = compactPagination ? 1 : 2;

    if (paginationState.totalPages <= maxDirectDisplay) {
      for (let p = 1; p <= paginationState.totalPages; p += 1) pages.push(p);
    } else {
      pages.push(1);

      let start = paginationState.currentPage - windowRadius;
      let end = paginationState.currentPage + windowRadius;

      if (start < 2) {
        end += 2 - start;
        start = 2;
      }

      if (end > paginationState.totalPages - 1) {
        start -= end - (paginationState.totalPages - 1);
        end = paginationState.totalPages - 1;
      }

      start = Math.max(2, start);
      end = Math.min(paginationState.totalPages - 1, end);

      if (start > 2) pages.push("ellipsis-start");

      for (let p = start; p <= end; p += 1) pages.push(p);

      if (end < paginationState.totalPages - 1) pages.push("ellipsis-end");

      pages.push(paginationState.totalPages);
    }

    const pageSize = isFilterActive ? effectiveLimit : limit || API_PAGE_SIZE;
    const resolvePageHref = (pageNumber) => {
      const positionValue = Math.max(0, (pageNumber - 1) * pageSize);
      return buildCreatorHref(positionValue);
    };

    const paginationContent = (
      <nav className="pagination">
        {!compactPagination && (
          <a
            className={`btn ghost${paginationState.hasPrev ? "" : " disabled"}`}
            href={paginationState.hasPrev ? resolvePageHref(paginationState.currentPage - 1) : "#"}
            aria-disabled={!paginationState.hasPrev}
            onClick={(event) => {
              if (!paginationState.hasPrev) {
                event.preventDefault();
                return;
              }
              if (isModifiedClick(event)) return;
              event.preventDefault();
              paginationState.goTo(paginationState.currentPage - 1);
            }}
          >
            &larr; Prev
          </a>
        )}
        <div className="pagination-pages">
          {pages.map((item) => {
            if (typeof item === "string") {
              return (
                <span key={item} className="pagination-ellipsis">
                  …
                </span>
              );
            }
            const isActive = item === paginationState.currentPage;
            return (
              <a
                key={item}
                className={`page-pill${isActive ? " active" : ""}`}
                href={resolvePageHref(item)}
                aria-current={isActive ? "page" : undefined}
                onClick={(event) => {
                  if (isModifiedClick(event)) return;
                  event.preventDefault();
                  if (isActive) return;
                  paginationState.goTo(item);
                }}
              >
                {item}
              </a>
            );
          })}
        </div>
        {!compactPagination && (
          <a
            className={`btn ghost${paginationState.hasNext ? "" : " disabled"}`}
            href={paginationState.hasNext ? resolvePageHref(paginationState.currentPage + 1) : "#"}
            aria-disabled={!paginationState.hasNext}
            onClick={(event) => {
              if (!paginationState.hasNext) {
                event.preventDefault();
                return;
              }
              if (isModifiedClick(event)) return;
              event.preventDefault();
              paginationState.goTo(paginationState.currentPage + 1);
            }}
          >
            Next &rarr;
          </a>
        )}
      </nav>
    );

    const paginationMeta = showMeta ? (
      <div className="pagination-meta">
        <span className="label">
          Page <strong>{paginationState.currentPage}</strong> of {paginationState.totalPages}
        </span>
        <button
          type="button"
          className={`order-toggle${reverseOrder ? " order-toggle-active" : ""}`}
          onClick={handleOrderToggle}
          aria-pressed={reverseOrder}
          title={reverseOrder ? "Sorted oldest to newest" : "Sorted newest to oldest"}
        >
          <span className="order-label">{reverseOrder ? "Oldest first" : "Newest first"}</span>
          <span className="order-arrow" aria-hidden="true">
            {reverseOrder ? "↑" : "↓"}
          </span>
        </button>
      </div>
    ) : null;

    return (
      <div className="pagination-block">
        {paginationMeta}
        {paginationContent}
      </div>
    );
  };

  return (
    <div className="page">
      <section className="card hero">
        <div className="hero-body">
          <div className="creator-heading">
            <div className="creator-avatar-wrapper">
              <img
                className="creator-avatar"
                src={avatarUrl}
                alt={`${resolvedCreatorName || creatorId} avatar`}
                loading="eager"
                referrerPolicy="no-referrer"
                onError={(event) => {
                  // Hide broken avatars gracefully
                  event.currentTarget.style.visibility = "hidden";
                }}
              />
            </div>
              <div className="creator-heading-text">
                <h2 className="title">{resolvedCreatorName || creatorId}</h2>
                <div className="creator-heading-meta">
                  {serviceLabel ? <span className="creator-service-badge">{serviceLabel}</span> : null}
                  <div className="creator-meta-stats">
                    <span className="muted small">
                      {loadingProfile ? "Loading profile..." : `${profile?.post_count ?? "-"} posts indexed`}
                    </span>
                    {canUseCacheUi && (useCache || cacheStorageError) && (
                      <span className="muted small cache-status-line">
                        {cacheStatusMessage || "Cache ready"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="card-actions">
              {canUseCacheUi && (
                <div className="cache-actions">
                  {useCache && (
                    <button
                      className="btn"
                    onClick={() => {
                      setReloadKey((value) => value + 1);
                    }}
                  >
                    Refresh posts
                  </button>
                )}
                <label className={`filter-toggle${useCache ? " filter-toggle-active" : ""}`} htmlFor="use-cache-toggle">
                  <input
                    id="use-cache-toggle"
                    type="checkbox"
                    checked={useCache}
                    onChange={(event) => setUseCache(event.target.checked)}
                  />
                  <span className="filter-toggle-track">
                    <span className="filter-toggle-thumb" />
                  </span>
                  Cache data
                </label>
                {cacheStorageError && (
                  <p className="muted small cache-status-line">Storage full. Cache has been disabled.</p>
                )}
              </div>
            )}
            {!alreadySaved && (
              <button className="btn primary" onClick={onSave}>
                Save creator
              </button>
            )}
          </div>
        </div>
        {profile?.description && (
          <div className="muted description" dangerouslySetInnerHTML={{ __html: profile.description }} />
        )}
      </section>

      <section className="card filter-card">
        <div className="filter-row">
          <div className="filter-controls">
            <form className="search-form" onSubmit={handleSearchSubmit}>
              <label className="label" htmlFor="post-search">
                Filter
              </label>
              <div className="search-field">
                <input
                  id="post-search"
                  className="search-input"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Filter by title, tag, or text"
                />
                {(searchInput || isFilterActive) && (
                  <button className="search-clear" type="button" onClick={handleSearchClear} disabled={searchLoading}>
                    Clear
                  </button>
                )}
                <button className="search-submit" type="submit" disabled={searchLoading}>
                  {searchLoading ? "Filtering..." : "Apply filter"}
                </button>
              </div>
            </form>
            <div className="filter-toggles">
              <label
                className={`filter-toggle${filterFields.title ? " filter-toggle-active" : ""}`}
                htmlFor="filter-title"
              >
                <input
                  id="filter-title"
                  type="checkbox"
                  checked={filterFields.title}
                  onChange={(event) => updateFilterField("title", event.target.checked)}
                />
                <span className="filter-toggle-track">
                  <span className="filter-toggle-thumb" />
                </span>
                Title
              </label>
              <label className={`filter-toggle${filterFields.tags ? " filter-toggle-active" : ""}`} htmlFor="filter-tags">
                <input
                  id="filter-tags"
                  type="checkbox"
                  checked={filterFields.tags}
                  onChange={(event) => updateFilterField("tags", event.target.checked)}
                />
                <span className="filter-toggle-track">
                  <span className="filter-toggle-thumb" />
                </span>
                Tags
              </label>
              <label className={`filter-toggle${filterFields.body ? " filter-toggle-active" : ""}`} htmlFor="filter-body">
                <input
                  id="filter-body"
                  type="checkbox"
                  checked={filterFields.body}
                  onChange={(event) => updateFilterField("body", event.target.checked)}
                />
                <span className="filter-toggle-track">
                  <span className="filter-toggle-thumb" />
                </span>
                Body text
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-row header-row">
          <div className="card-col">
            <h3 className="title">Posts</h3>
            <span className="label">{summaryLabel}</span>
          </div>
          <div className="controls post-controls">
            <div className="display-toggle-group">
              <span className="label display-label">Display</span>
              <div className="display-toggle-options">
                <label
                  className={`filter-toggle${showExcerpts ? " filter-toggle-active" : ""}`}
                  htmlFor="show-excerpts"
                >
                  <input
                    id="show-excerpts"
                    type="checkbox"
                    checked={showExcerpts}
                    onChange={(event) => setShowExcerpts(event.target.checked)}
                  />
                  <span className="filter-toggle-track">
                    <span className="filter-toggle-thumb" />
                  </span>
                  Excerpts
                </label>
                <label className={`filter-toggle${showTags ? " filter-toggle-active" : ""}`} htmlFor="show-tags">
                  <input
                    id="show-tags"
                    type="checkbox"
                    checked={showTags}
                    onChange={(event) => setShowTags(event.target.checked)}
                  />
                  <span className="filter-toggle-track">
                    <span className="filter-toggle-thumb" />
                  </span>
                  Tags
                </label>
                <label
                  className={`filter-toggle${showFeatureBackgrounds ? " filter-toggle-active" : ""}`}
                  htmlFor="show-feature-bg"
                >
                  <input
                    id="show-feature-bg"
                    type="checkbox"
                    checked={showFeatureBackgrounds}
                    onChange={(event) => setShowFeatureBackgrounds(event.target.checked)}
                  />
                  <span className="filter-toggle-track">
                    <span className="filter-toggle-thumb" />
                  </span>
                  Feature image
                </label>
              </div>
            </div>
            <div className="order-size-group">
              <div className="page-size-control">
                <label className="label" htmlFor="page-size">
                  Page size
                </label>
                <select
                  id="page-size"
                  className="input small"
                  value={limit}
                  onChange={(event) => {
                    const parsed = parseInt(event.target.value, 10);
                    const nextLimit = PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : API_PAGE_SIZE;
                    setOffset(0);
                    setLimit(nextLimit);
                    setSearchPage(1);
                    if (!isFilterActive) {
                      rememberPosition(0, { pageSize: nextLimit });
                    }
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
        {renderPagination()}
        <div className="post-list" ref={postListRef}>
          {virtualizedPosts.topSpacer > 0 && (
            <div className="post-list-spacer" style={{ height: `${virtualizedPosts.topSpacer}px` }} aria-hidden="true" />
          )}
          {virtualizedPosts.items.map((post, localIndex) => {
            const index = virtualizedPosts.startIndex + localIndex;
            const detailData = postDetailMap[post.id];
            const excerptHtml = showExcerpts ? getPostExcerptHtml(detailData || post) : null;
            const postTags = Array.isArray(post.tags) ? post.tags : postTagMap[post.id];
            const normalizedTags = Array.isArray(postTags) ? postTags : [];
            const hasTags = normalizedTags.length > 0;
            const pageSizeForPosition = limit || initialPageSizeRef.current || API_PAGE_SIZE;
            const resolvedOffset =
              Number.isFinite(post?.__position) && !isFilterActive
                ? Math.max(0, Math.floor(post.__position / pageSizeForPosition) * pageSizeForPosition)
                : undefined;
            const handleOpenPost = () => {
              if (isFilterActive) {
                rememberPosition(currentFilteredOffset || 0, { pageSize: effectiveLimit });
              } else if (Number.isFinite(post?.__position)) {
                rememberPosition(post.__position, { pageSize: pageSizeForPosition });
              }
              onOpenPost(post.id, post.title || "", resolvedOffset);
            };
            const postHref = getUrlForView({
              name: "post",
              service,
              creatorId,
              creatorName: resolvedCreatorName || creatorId,
              postId: post.id,
              position: isFilterActive ? currentFilteredOffset ?? undefined : resolvedOffset,
            });
            const featureFile =
              post?.file && (post.file.path || post.file.url || post.file.name) ? post.file : null;
            const featureKey = resolvePostFeatureKey(post, index);
            const isFeatureCandidate = showFeatureBackgrounds && Boolean(featureFile);
            const featureProxySrc = featureFile?.path ? `${MEDIA_BASE}${featureFile.path}` : null;
            const featureOriginalSrc =
              featureFile?.url || (featureFile?.path ? `${ORIGINAL_MEDIA_BASE}${featureFile.path}` : null);
            const featureImage =
              isFeatureCandidate && visibleFeatureKeys.has(featureKey) ? featureProxySrc || featureOriginalSrc : null;
            const postItemClass = `post-item${featureImage ? " feature-background" : ""}`;
            const postItemStyle = featureImage ? { "--post-feature-image": `url("${featureImage}")` } : undefined;
            return (
              <a
                className={postItemClass}
                style={postItemStyle}
                key={`${post?.id ?? `idx-${index}`}-${Number.isFinite(post?.__position) ? post.__position : post.updated || post.published || index}`}
                href={postHref}
                data-feature-key={isFeatureCandidate ? featureKey : undefined}
                onClick={(event) => {
                  if (isModifiedClick(event)) {
                    return;
                  }
                  event.preventDefault();
                  handleOpenPost();
                }}
              >
                <div className="post-body">
                  <div className="post-head">
                    <span className="post-title">{post.title || post.id}</span>
                    <Timestamp value={post.published} />
                  </div>
                  {showTags && hasTags && (
                    <div className="tag-row">
                      {normalizedTags.map((tag) => (
                        <span className="tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {showExcerpts && excerptHtml && (
                    <p className="excerpt" dangerouslySetInnerHTML={{ __html: excerptHtml }} />
                  )}
                </div>
              </a>
            );
          })}
          {virtualizedPosts.bottomSpacer > 0 && (
            <div className="post-list-spacer" style={{ height: `${virtualizedPosts.bottomSpacer}px` }} aria-hidden="true" />
          )}
        </div>
        {!listLoading && displayedPosts.length === 0 && (
          <div className="muted empty-state">
            {isFilterActive ? "No posts match your filter yet." : "No posts found for this page."}
          </div>
        )}
        {renderPagination({ showMeta: false })}
      </section>
    </div>
  );
}

export default CreatorPage;
