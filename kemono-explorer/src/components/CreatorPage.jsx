import React, { useCallback, useEffect, useRef, useState } from "react";

import Timestamp from "./Timestamp.jsx";
import { API_BASE, API_PAGE_SIZE, CACHE_VERSION, MAX_CACHE_POSTS, MAX_SEARCH_RESULTS, PAGE_SIZE_KEY, PAGE_SIZE_OPTIONS } from "../constants.js";
import { fetchJson } from "../utils/api.js";
import { getCachePreferenceKey, loadCreatorCache, writeCreatorCache, isCacheFresh, pruneCacheChunks, pruneCachePostDetails, collectCachedPosts } from "../utils/cache.js";
import { formatDate } from "../utils/date.js";
import { extractTagTokens, getPostExcerptHtml, getServiceLabel, toNumericCount } from "../utils/posts.js";
import { getInitialPageSize, readBooleanPreference } from "../utils/preferences.js";

function CreatorPage({
  service,
  creatorId,
  creatorName,
  alreadySaved,
  onOpenPost,
  onSave,
  activeFilter,
  onUpdateFilter,
}) {
  const cachePrefKey = getCachePreferenceKey(service, creatorId);
  const [useCache, setUseCache] = useState(() => readBooleanPreference(cachePrefKey, false));
  const [cacheData, setCacheData] = useState(() => loadCreatorCache(service, creatorId));
  const [cacheReloadApplied, setCacheReloadApplied] = useState(0);
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(getInitialPageSize);
  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) return;
    if (!PAGE_SIZE_OPTIONS.includes(limit)) return;
    try {
      window.localStorage.setItem(PAGE_SIZE_KEY, String(limit));
    } catch {
      // ignore persistence issues
    }
  }, [limit]);
  const [showExcerpts, setShowExcerpts] = useState(() => {
    try {
      const stored = localStorage.getItem("kemono.showExcerpts");
      if (stored === "true" || stored === "false") return stored === "true";
    } catch {
      // ignore
    }
    return true;
  });
  const [showTags, setShowTags] = useState(() => {
    try {
      const stored = localStorage.getItem("kemono.showTags");
      if (stored === "true" || stored === "false") return stored === "true";
    } catch {
      // ignore
    }
    return true;
  });
  const [postTagMap, setPostTagMap] = useState({});
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchCapped, setSearchCapped] = useState(false);
  const filterStorageKey = `kemono.filterFields.${service}.${creatorId}`;
  const reversePrefKey = `kemono.reverseOrder.${service}.${creatorId}`;
  const [reverseOrder, setReverseOrder] = useState(() => readBooleanPreference(reversePrefKey, false));
  const updateCache = useCallback(
    (updater, { updateTimestamp = true } = {}) => {
      setCacheData((prev) => {
        const base = prev && prev.version === CACHE_VERSION ? prev : { version: CACHE_VERSION };
        const nextBase = typeof updater === "function" ? updater(base) : updater;
        if (!nextBase) {
          writeCreatorCache(service, creatorId, null);
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
        writeCreatorCache(service, creatorId, next);
        return next;
      });
    },
    [service, creatorId],
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
  const prevFilterStorageKeyRef = useRef(filterStorageKey);
  const cacheFresh = useCache && cacheData ? isCacheFresh(cacheData) : false;
  const canUseCacheUi = alreadySaved;
  const resolvedProfileCount = toNumericCount(profile?.post_count);
  const resolvedCacheCount = toNumericCount(cacheData?.totalPosts);
  const totalPosts = resolvedProfileCount ?? resolvedCacheCount ?? null;

  useEffect(() => {
    setUseCache(readBooleanPreference(cachePrefKey, false));
    setCacheData(loadCreatorCache(service, creatorId));
    setCacheReloadApplied(0);
    setReverseOrder(readBooleanPreference(reversePrefKey, false));
  }, [cachePrefKey, service, creatorId, reversePrefKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(cachePrefKey, useCache ? "true" : "false");
    } catch {
      // ignore preference persistence failures
    }
  }, [useCache, cachePrefKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(reversePrefKey, reverseOrder ? "true" : "false");
    } catch {
      // ignore persistence failures
    }
  }, [reverseOrder, reversePrefKey]);

  useEffect(() => {
    if (!useCache) return;
    setCacheData((prev) => (prev ? prev : loadCreatorCache(service, creatorId)));
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

  useEffect(() => {
    let alive = true;
    const cachedProfile = useCache && cacheData?.profile ? cacheData.profile : null;
    if (cachedProfile) {
      setProfile(cachedProfile);
      setLoadingProfile(false);
    } else {
      setLoadingProfile(true);
    }

    const shouldFetch =
      !useCache ||
      !cachedProfile ||
      !cacheFresh ||
      cacheReloadApplied !== reloadKey;

    if (!shouldFetch) {
      return () => {
        alive = false;
      };
    }

    setLoadingProfile(true);
    fetchJson(`${API_BASE}/${service}/user/${creatorId}/profile`).then((data) => {
      if (!alive) return;
      setProfile(data);
      setLoadingProfile(false);
      if (useCache) {
        if (data) {
          const numericCount = toNumericCount(data?.post_count);
          updateCache((prev) => ({
            ...prev,
            profile: data,
            totalPosts: numericCount ?? prev.totalPosts,
          }));
        }
        setCacheReloadApplied(reloadKey);
      }
    });
    return () => {
      alive = false;
    };
  }, [service, creatorId, useCache, cacheData, cacheFresh, cacheReloadApplied, reloadKey, updateCache]);

  useEffect(() => {
    try {
      localStorage.setItem("kemono.showExcerpts", showExcerpts ? "true" : "false");
    } catch {
      // ignore
    }
  }, [showExcerpts]);
  useEffect(() => {
    try {
      localStorage.setItem("kemono.showTags", showTags ? "true" : "false");
    } catch {
      // ignore
    }
  }, [showTags]);
  useEffect(() => {
    setPostTagMap({});
  }, [service, creatorId]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) return;
    const storageKeyChanged = prevFilterStorageKeyRef.current !== filterStorageKey;
    if (storageKeyChanged) {
      prevFilterStorageKeyRef.current = filterStorageKey;
      return;
    }
    prevFilterStorageKeyRef.current = filterStorageKey;
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
  }, [filterStorageKey, filterFields]);

  useEffect(() => {
    const trimmed = typeof activeFilter === "string" ? activeFilter.trim() : "";
    if (!trimmed) return;
    setSearchPage(1);
    setSearchCapped(false);
    runSearch({ query: trimmed });
  }, [filterFields.title, filterFields.tags, filterFields.body, activeFilter]);

  useEffect(() => {
    const trimmedFilter = typeof activeFilter === "string" ? activeFilter.trim() : "";
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

  const runSearch = async ({ query } = {}) => {
    const trimmed = (query || "").trim();
    const tagTokens = filterFields.tags ? extractTagTokens(trimmed) : [];
    const textQueryEnabled = filterFields.title || filterFields.body;
    const applyTextQuery = textQueryEnabled && (!filterFields.tags || tagTokens.length === 0);
    const textQuery = applyTextQuery ? trimmed : "";
    const hasQuery = textQuery.length > 0;
    const hasTags = filterFields.tags && tagTokens.length > 0;
    if (!hasQuery && !hasTags) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchCapped(false);
      return;
    }

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

    if (useCache && cacheFresh) {
      const cachedPostsForSearch = collectCachedPosts(cacheData);
      if (cachedPostsForSearch && cachedPostsForSearch.length > 0) {
        const tokens = textQuery
          ? textQuery
              .toLowerCase()
              .split(/\s+/)
              .map((token) => token.trim())
              .filter(Boolean)
          : [];
        const lowerTagTokens = tagTokens.map((token) => token.toLowerCase());
        const results = cachedPostsForSearch.filter((post) => {
          if (!post) return false;
          if (lowerTagTokens.length > 0) {
            const postTags = Array.isArray(post.tags)
              ? post.tags.map((tag) => String(tag).toLowerCase())
              : [];
            const matchesAllTags = lowerTagTokens.every((token) => postTags.includes(token));
            if (!matchesAllTags) return false;
          }
          if (tokens.length === 0) return true;
          const haystacks = [];
          if (normalizedFields.title) {
            if (typeof post.title === "string") haystacks.push(post.title);
            if (typeof post.id === "string") haystacks.push(post.id);
          }
          if (normalizedFields.body) {
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
          if (haystacks.length === 0) return false;
          const normalizedHaystacks = haystacks.map((value) => value.toLowerCase());
          return tokens.every((token) => normalizedHaystacks.some((hay) => hay.includes(token)));
        });
        const cacheTotalPosts = toNumericCount(cacheData?.totalPosts);
        const cacheComplete =
          typeof cacheTotalPosts === "number" &&
          cacheTotalPosts > 0 &&
          cacheTotalPosts <= MAX_CACHE_POSTS &&
          cachedPostsForSearch.length >= cacheTotalPosts;
        const capped = Boolean(cacheTotalPosts && cacheTotalPosts > cachedPostsForSearch.length);
        if (results.length > 0 || cacheComplete) {
          setSearchResults(results);
          setSearchCapped(capped);
          setSearchLoading(false);
          return;
        }
        // Fall through to API search when cache did not yield any hits and we cannot prove completeness.
      }
    }

    const token = (searchTokenRef.current += 1);
    const encodedQuery = hasQuery ? encodeURIComponent(textQuery.replace(/,/g, " ").trim()) : "";
    const filterBody = normalizedFields.body ? "true" : "false";
    const filterTitle = normalizedFields.title ? "true" : "false";
    const filterTags = normalizedFields.tags ? "true" : "false";
    const fieldParams = `&title=${filterTitle}&tags=${filterTags}&body=${filterBody}`;
    const tagParams =
      normalizedFields.tags && tagTokens.length > 0
        ? tagTokens.map((tag) => `&tag=${encodeURIComponent(tag)}`).join("")
        : "";

    setSearchLoading(true);
    setSearchResults([]);
    setSearchCapped(false);

    let workingResults = [];
    let offset = 0;
    let exhausted = false;
    let capped = false;

    try {
      while (!exhausted && workingResults.length < MAX_SEARCH_RESULTS) {
        const chunk = await fetchJson(
          `${API_BASE}/${service}/user/${creatorId}/posts?o=${offset}&n=${API_PAGE_SIZE}${hasQuery ? `&q=${encodedQuery}` : ""}${fieldParams}${tagParams}`,
        );
        if (token !== searchTokenRef.current) return;
        if (!Array.isArray(chunk) || chunk.length === 0) {
          exhausted = true;
          break;
        }
        if (useCache && chunk.length > 0) {
          updateCache((prev) => {
            const prevChunks = prev?.chunks ? { ...prev.chunks } : {};
            prevChunks[String(offset)] = chunk.slice();
            return {
              ...prev,
              chunks: pruneCacheChunks(prevChunks),
            };
          });
        }
        workingResults = workingResults.concat(chunk);
        offset += API_PAGE_SIZE;
        if (chunk.length < API_PAGE_SIZE) {
          exhausted = true;
        }
        if (workingResults.length >= MAX_SEARCH_RESULTS) {
          capped = true;
          break;
        }
      }

      if (token !== searchTokenRef.current) return;

      setSearchResults(workingResults);
      setSearchCapped(capped);
    } catch (error) {
      console.error("Post search failed", error);
      if (token !== searchTokenRef.current) return;
      setSearchResults([]);
      setSearchCapped(false);
    } finally {
      if (token === searchTokenRef.current) {
        setSearchLoading(false);
      }
    }
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

    if (requested === 0) {
      setPosts([]);
      setHasNextPage(false);
      setLoadingPosts(false);
      return () => {
        alive = false;
      };
    }

    const firstChunkOffset = Math.floor(start / API_PAGE_SIZE) * API_PAGE_SIZE;
    const lastIndexNeeded = Math.max(start, start + requested - 1);
    const lastChunkOffset = Math.floor(lastIndexNeeded / API_PAGE_SIZE) * API_PAGE_SIZE;

    const chunkOffsets = [];
    for (let current = firstChunkOffset; current <= lastChunkOffset; current += API_PAGE_SIZE) {
      chunkOffsets.push(current);
    }
    if (chunkOffsets.length === 0) chunkOffsets.push(0);

    const cachedChunks = useCache && cacheData?.chunks ? cacheData.chunks : null;
    const responsesFromCache = cachedChunks
      ? chunkOffsets.map((chunkOffset) => cachedChunks[String(chunkOffset)])
      : [];
    const allChunksCached =
      useCache && cachedChunks ? responsesFromCache.every((chunk) => Array.isArray(chunk)) : false;

    const sliceFromResponses = (responses) => {
      const combined = responses.reduce((acc, data) => {
        if (Array.isArray(data) && data.length) {
          acc.push(...data);
        }
        return acc;
      }, []);
      const sliceStart = start - chunkOffsets[0];
      const slice = combined.slice(sliceStart, sliceStart + requested);
      const totalKnown = typeof totalPosts === "number" ? totalPosts : null;
      const lastResponse = responses[responses.length - 1];
      const lastChunkLength = Array.isArray(lastResponse) ? lastResponse.length : 0;
      const availableFromStart = Math.max(0, combined.length - sliceStart);
      const hasMore =
        typeof totalKnown === "number"
          ? start + slice.length < totalKnown
          : availableFromStart > slice.length || lastChunkLength === API_PAGE_SIZE;
      return { combined, slice, hasMore };
    };

    if (allChunksCached) {
      const { slice, hasMore } = sliceFromResponses(responsesFromCache);
      setPosts(slice);
      setHasNextPage(hasMore);
      if (cacheFresh && cacheReloadApplied === reloadKey) {
        setLoadingPosts(false);
        return () => {
          alive = false;
        };
      }
      // continue to refresh cache if requested
    }

    const shouldBypassCache = !useCache || !cacheFresh || cacheReloadApplied !== reloadKey;
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
        }
      })
      .catch((error) => {
        console.error("Failed to load posts", error);
        if (!alive) return;
        setPosts([]);
        setHasNextPage(false);
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
    cacheReloadApplied,
    totalPosts,
    reverseOrder,
    updateCache,
  ]);

  const normalizedFilter = typeof activeFilter === "string" ? activeFilter.trim() : "";
  const isFilterActive = normalizedFilter.length > 0;
  const activeTags = filterFields.tags ? extractTagTokens(normalizedFilter) : [];
  const effectiveLimit = limit > 0 ? limit : API_PAGE_SIZE;
  const totalFilteredPosts = searchResults.length;
  const filteredTotalPages = isFilterActive
    ? Math.max(1, Math.ceil(Math.max(totalFilteredPosts, 1) / effectiveLimit))
    : 1;
  const clampedSearchPage = isFilterActive ? Math.min(Math.max(searchPage, 1), filteredTotalPages) : 1;
  const pageStart = isFilterActive ? Math.max(0, (clampedSearchPage - 1) * effectiveLimit) : 0;
  const baseSearchResults = reverseOrder ? [...searchResults].reverse() : searchResults;
  const displayedPosts = isFilterActive ? baseSearchResults.slice(pageStart, pageStart + effectiveLimit) : posts;
  const listLoading = isFilterActive ? searchLoading && displayedPosts.length === 0 : loadingPosts;
  const orderedPosts = !isFilterActive && reverseOrder ? [...displayedPosts].reverse() : displayedPosts;
  const cacheUpdatedAt = useCache && cacheData?.updatedAt ? cacheData.updatedAt : null;
  const cacheUpdatedStamp = cacheUpdatedAt ? formatDate(cacheUpdatedAt) : null;
  const cacheUpdatedLabel = cacheUpdatedStamp
    ? `${cacheUpdatedStamp.date}${cacheUpdatedStamp.time ? ` ${cacheUpdatedStamp.time}` : ""}`
    : null;

  useEffect(() => {
    if (!isFilterActive) return;
    if (!searchResults.length) return;
    if (searchPage === clampedSearchPage) return;
    setSearchPage(clampedSearchPage);
  }, [isFilterActive, searchResults.length, clampedSearchPage, searchPage]);

  useEffect(() => {
    if (!showTags) return;
    if (isFilterActive) return;
    if (!posts.length) return;

    const missing = posts.filter(
      (post) => !Array.isArray(post.tags) && !Array.isArray(postTagMap[post.id]),
    );
    if (missing.length === 0) return;

    let alive = true;

    (async () => {
      const results = await Promise.all(
        missing.map(async (post) => {
          try {
            const data = await fetchJson(`${API_BASE}/${service}/user/${creatorId}/post/${post.id}`);
            const tags = Array.isArray(data?.post?.tags)
              ? data.post.tags.map((tag) => String(tag))
              : [];
            return { id: post.id, tags };
          } catch (error) {
            console.error("Failed to load tags for post", post.id, error);
            return { id: post.id, tags: [] };
          }
        }),
      );
      if (!alive) return;
      setPostTagMap((prev) => {
        const next = { ...prev };
        for (const { id, tags } of results) {
          if (!next[id] && Array.isArray(tags)) {
            next[id] = tags;
          }
        }
        return next;
      });
    })();

    return () => {
      alive = false;
    };
  }, [showTags, isFilterActive, posts, service, creatorId, postTagMap]);

  const hasPrev = offset > 0;
  const derivedTotalPages =
    typeof totalPosts === "number" && limit > 0 ? Math.max(1, Math.ceil(totalPosts / limit)) : null;
  const currentPage = limit > 0 ? Math.floor(offset / limit) + 1 : 1;
  const hasNext = derivedTotalPages ? offset + limit < totalPosts : hasNextPage;
  const totalPages = derivedTotalPages ?? currentPage + (hasNext ? 1 : 0);
  const avatarUrl = `https://img.kemono.cr/icons/${service}/${creatorId}`;
  const serviceLabel = getServiceLabel(service);
  const filterDescriptor =
    activeTags.length > 0
      ? `${activeTags.length} tag${activeTags.length === 1 ? "" : "s"}`
      : `"${normalizedFilter}"`;
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

  function goToPage(page) {
    if (!limit) return;
    setOffset(Math.max(0, (page - 1) * limit));
  }

  const goToSearchPage = (page) => {
    setSearchPage((prev) => {
      const nextNumeric = Number.isFinite(page) ? Math.trunc(page) : prev;
      const next = Math.min(Math.max(nextNumeric || 1, 1), filteredTotalPages || 1);
      return next === prev ? prev : next;
    });
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

  const handleOrderToggle = () => {
    if (isFilterActive) {
      setSearchPage(1);
    } else {
      setOffset(0);
    }
    setReverseOrder((prev) => !prev);
  };

  const renderPagination = () => {
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

    return (
      <div className="pagination-block">
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
        <nav className="pagination">
          {!compactPagination && (
            <button
              className="btn ghost"
              type="button"
              disabled={!paginationState.hasPrev}
              onClick={() => paginationState.hasPrev && paginationState.goTo(paginationState.currentPage - 1)}
            >
              &larr; Prev
            </button>
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
                <button
                  key={item}
                  className={`page-pill${isActive ? " active" : ""}`}
                  type="button"
                  onClick={() => paginationState.goTo(item)}
                  disabled={isActive}
                >
                  {item}
                </button>
              );
            })}
          </div>
          {!compactPagination && (
            <button
              className="btn ghost"
              type="button"
              disabled={!paginationState.hasNext}
              onClick={() => paginationState.hasNext && paginationState.goTo(paginationState.currentPage + 1)}
            >
              Next &rarr;
            </button>
          )}
        </nav>
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
                alt={`${creatorName || creatorId} avatar`}
                loading="eager"
                referrerPolicy="no-referrer"
                onError={(event) => {
                  // Hide broken avatars gracefully
                  event.currentTarget.style.visibility = "hidden";
                }}
              />
            </div>
              <div className="creator-heading-text">
                <h2 className="title">{creatorName || creatorId}</h2>
                <div className="creator-heading-meta">
                  {serviceLabel ? <span className="creator-service-badge">{serviceLabel}</span> : null}
                  <div className="creator-meta-stats">
                    <span className="muted small">
                      {loadingProfile ? "Loading profile..." : `${profile?.post_count ?? "-"} posts indexed`}
                    </span>
                    {canUseCacheUi && useCache && (
                      <span className="muted small cache-status-line">
                        {cacheFresh && cacheUpdatedLabel
                          ? `Cached locally • updated ${cacheUpdatedLabel}`
                          : "Cache refreshing from source..."}
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
        <div className="post-list">
          {orderedPosts.map((post) => {
            const excerptHtml = showExcerpts ? getPostExcerptHtml(post) : null;
            const postTags = Array.isArray(post.tags) ? post.tags : postTagMap[post.id];
            const normalizedTags = Array.isArray(postTags) ? postTags : [];
            const hasTags = normalizedTags.length > 0;
            return (
              <button
                className="post-item"
                key={post.id}
                type="button"
                onClick={() => onOpenPost(post.id, post.title || "")}
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
              </button>
            );
          })}
        </div>
        {!listLoading && displayedPosts.length === 0 && (
          <div className="muted empty-state">
            {isFilterActive ? "No posts match your filter yet." : "No posts found for this page."}
          </div>
        )}
        {renderPagination()}
      </section>
    </div>
  );
}

export default CreatorPage;
