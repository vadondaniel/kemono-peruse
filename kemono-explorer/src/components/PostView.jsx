import React, { useCallback, useEffect, useRef, useState } from "react";

import Timestamp from "./Timestamp.jsx";
import { API_BASE, API_PAGE_SIZE, CACHE_VERSION, MEDIA_BASE, READER_ALIGNMENT_OPTIONS, READER_ALIGNMENT_VALUES, READER_INDENT_OPTIONS, READER_INDENT_VALUES, READER_LINE_SPACING_OPTIONS, READER_LINE_SPACING_VALUES, READER_TEXT_SCALE_OPTIONS, READER_TEXT_SCALE_VALUES, READER_TYPEFACE_OPTIONS, READER_TYPEFACE_VALUES, READER_WIDTH_OPTIONS, READER_WIDTH_VALUES } from "../constants.js";
import { fetchJson } from "../utils/api.js";
import { getCachePreferenceKey, loadCreatorCache, writeCreatorCache, isCacheFresh, pruneCacheChunks, pruneCachePostDetails } from "../utils/cache.js";
import { extractTagTokens, getServiceLabel, normalizePostHtml } from "../utils/posts.js";
import { getInitialReaderSettings, getTypefacePreviewStyle, readBooleanPreference } from "../utils/preferences.js";

function PostView({
  service,
  creatorId,
  creatorName,
  postId,
  activeFilter,
  readerSettingsOpen,
  onCloseReaderSettings,
  onBack,
  onNavigate,
  onResolvePostTitle,
}) {
  const cachePrefKey = getCachePreferenceKey(service, creatorId);
  const [useCache, setUseCacheState] = useState(() => readBooleanPreference(cachePrefKey, false));
  const [cacheData, setCacheData] = useState(() => loadCreatorCache(service, creatorId));
  const [readerSettings, setReaderSettings] = useState(getInitialReaderSettings);
  const cacheFresh = useCache && cacheData ? isCacheFresh(cacheData) : false;
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

  useEffect(() => {
    setUseCacheState(readBooleanPreference(cachePrefKey, false));
    setCacheData(loadCreatorCache(service, creatorId));
  }, [cachePrefKey, service, creatorId]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      window.localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(readerSettings));
    } catch {
      // ignore preference persistence issues
    }
  }, [readerSettings]);

  useEffect(() => {
    if (!readerSettingsOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && typeof onCloseReaderSettings === "function") {
        onCloseReaderSettings();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [readerSettingsOpen, onCloseReaderSettings]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    if (!readerSettingsOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [readerSettingsOpen]);

  const updateReaderSetting = (key, value) => {
    setReaderSettings((prev) => {
      if (key === "textScale") {
        if (!READER_TEXT_SCALE_VALUES.includes(value) || prev.textScale === value) {
          return prev;
        }
        return { ...prev, textScale: value };
      }
      if (key === "lineSpacing") {
        if (!READER_LINE_SPACING_VALUES.includes(value) || prev.lineSpacing === value) {
          return prev;
        }
        return { ...prev, lineSpacing: value };
      }
      if (key === "widthMode") {
        if (!READER_WIDTH_VALUES.includes(value) || prev.widthMode === value) {
          return prev;
        }
        return { ...prev, widthMode: value };
      }
      if (key === "typeface") {
        if (!READER_TYPEFACE_VALUES.includes(value) || prev.typeface === value) {
          return prev;
        }
        return { ...prev, typeface: value };
      }
      if (key === "textAlign") {
        if (!READER_ALIGNMENT_VALUES.includes(value) || prev.textAlign === value) {
          return prev;
        }
        return { ...prev, textAlign: value };
      }
      if (key === "textIndent") {
        if (!READER_INDENT_VALUES.includes(value) || prev.textIndent === value) {
          return prev;
        }
        return { ...prev, textIndent: value };
      }
      return prev;
    });
  };

  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [neighbors, setNeighbors] = useState({ newerId: null, olderId: null });
  const serviceLabel = getServiceLabel(service);
  const creatorLabel = creatorName || creatorId || "";
  const creatorDisplay = creatorLabel
    ? serviceLabel
      ? `${creatorLabel} (${serviceLabel})`
      : creatorLabel
    : serviceLabel;
  const lastResolvedTitleRef = useRef(null);
  useEffect(() => {
    if (!post || typeof onResolvePostTitle !== "function") return;
    const nextTitle = post.title || post.id || "";
    if (lastResolvedTitleRef.current === nextTitle) return;
    lastResolvedTitleRef.current = nextTitle;
    onResolvePostTitle(nextTitle);
  }, [post, onResolvePostTitle]);
  const getStoredFilterFields = () => {
    const defaults = { title: true, tags: true, body: true };
    if (typeof window === "undefined" || !window.localStorage) return defaults;
    try {
      const stored = window.localStorage.getItem(`kemono.filterFields.${service}.${creatorId}`);
      if (!stored) return defaults;
      const parsed = JSON.parse(stored);
      const fields = {
        title: parsed?.title !== undefined ? Boolean(parsed.title) : true,
        tags: parsed?.tags !== undefined ? Boolean(parsed.tags) : true,
        body: parsed?.body !== undefined ? Boolean(parsed.body) : true,
      };
      if (!fields.title && !fields.tags && !fields.body) {
        return defaults;
      }
      return fields;
    } catch {
      return defaults;
    }
  };
  const buildFieldQueryParams = (fields) => {
    const resolved = fields || getStoredFilterFields();
    return `&title=${resolved.title ? "true" : "false"}&tags=${resolved.tags ? "true" : "false"}&body=${resolved.body ? "true" : "false"}`;
  };

  useEffect(() => {
    let alive = true;
    const cachedEntry =
      useCache && cacheData?.postDetails && cacheData.postDetails[postId]
        ? cacheData.postDetails[postId]
        : null;
    if (cachedEntry?.data) {
      setPost(cachedEntry.data);
      setLoading(false);
    } else {
      setLoading(true);
    }

    const shouldFetch = !useCache || !cachedEntry?.data || !cacheFresh;
    if (!shouldFetch) {
      return () => {
        alive = false;
      };
    }

    setLoading(true);
    fetchJson(`${API_BASE}/${service}/user/${creatorId}/post/${postId}`).then((data) => {
      if (!alive) return;
      const nextPost = data?.post || null;
      setPost(nextPost);
      setLoading(false);
      if (useCache && nextPost) {
        updateCache((prev) => ({
          ...prev,
          postDetails: {
            ...(prev.postDetails || {}),
            [postId]: { data: nextPost, updatedAt: Date.now() },
          },
        }));
      }
    });
    return () => {
      alive = false;
    };
  }, [service, creatorId, postId, useCache, cacheData, cacheFresh, updateCache]);

  useEffect(() => {
    let alive = true;
    setNeighbors({ newerId: null, olderId: null });

    const trimmedFilter = typeof activeFilter === "string" ? activeFilter.trim() : "";
    const storedFields = getStoredFilterFields();
    const tagTokens = trimmedFilter ? extractTagTokens(trimmedFilter) : [];
    const textQueryEnabled = storedFields.title || storedFields.body;
    const applyTextQuery = textQueryEnabled && (!storedFields.tags || tagTokens.length === 0);
    const textQuery = applyTextQuery ? trimmedFilter : "";
    const queryParam = textQuery ? `&q=${encodeURIComponent(textQuery)}` : "";
    const fieldParams = trimmedFilter ? buildFieldQueryParams(storedFields) : "";
    const tagParams =
      trimmedFilter && storedFields.tags && tagTokens.length > 0
        ? tagTokens.map((tag) => `&tag=${encodeURIComponent(tag)}`).join("")
        : "";

    const resolveNeighbors = async () => {
      let offset = 0;
      let prevChunkLast = null;

      try {
        while (alive) {
          const chunk = await fetchJson(
            `${API_BASE}/${service}/user/${creatorId}/posts?o=${offset}&n=${API_PAGE_SIZE}${queryParam}${fieldParams}${tagParams}`,
          );
          if (!alive) return;
          if (!Array.isArray(chunk) || chunk.length === 0) break;

          const idx = chunk.findIndex((item) => `${item.id}` === `${postId}`);
          if (idx !== -1) {
            let newerId = null;
            let olderId = null;

            if (idx > 0) {
              newerId = chunk[idx - 1]?.id ?? null;
            } else {
              newerId = prevChunkLast?.id ?? null;
            }

            if (idx < chunk.length - 1) {
              olderId = chunk[idx + 1]?.id ?? null;
            } else if (chunk.length === API_PAGE_SIZE) {
              const nextChunk = await fetchJson(
                `${API_BASE}/${service}/user/${creatorId}/posts?o=${offset + API_PAGE_SIZE}&n=${API_PAGE_SIZE}${queryParam}${fieldParams}${tagParams}`,
              );
              if (!alive) return;
              if (Array.isArray(nextChunk) && nextChunk.length > 0) {
                olderId = nextChunk[0]?.id ?? null;
              }
            }

            setNeighbors({
              newerId: newerId ?? null,
              olderId: olderId ?? null,
            });
            return;
          }

          prevChunkLast = chunk[chunk.length - 1] ?? prevChunkLast;
          offset += API_PAGE_SIZE;
          if (chunk.length < API_PAGE_SIZE) break;
        }

        setNeighbors({ newerId: null, olderId: null });
      } catch (error) {
        console.error("Failed to resolve post neighbors", error);
        if (!alive) return;
        setNeighbors({ newerId: null, olderId: null });
      }
    };

    resolveNeighbors();

    return () => {
      alive = false;
    };
  }, [service, creatorId, postId, activeFilter]);

  if (loading) {
    return (
      <div className="page">
        <div className="card">
          <p className="muted">Loading post...</p>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="page">
        <div className="card">
          <p className="muted">This post could not be loaded.</p>
        </div>
      </div>
    );
  }

  const attachments = Array.isArray(post.attachments) ? post.attachments : [];
  const bodyHtml = post.content || post.body || post.text || "";
  const normalizedHtml = bodyHtml
    ? normalizePostHtml(bodyHtml, { service: post.service || service, attachments, mediaBase: MEDIA_BASE })
    : "";
  const heroImage = post.file?.path ? `${MEDIA_BASE}${post.file.path}` : null;
  const readerCardClassName = [
    "card post-card",
    `reader-width-${readerSettings.widthMode}`,
    `reader-scale-${readerSettings.textScale}`,
    `reader-leading-${readerSettings.lineSpacing}`,
    `reader-align-${readerSettings.textAlign}`,
    `reader-indent-${readerSettings.textIndent}`,
    `reader-font-${readerSettings.typeface}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="page">
      <article className={readerCardClassName}>
        <div className="post-nav">
          <button
            className="btn ghost"
            type="button"
            disabled={!neighbors.olderId}
            onClick={() => neighbors.olderId && onNavigate && onNavigate(neighbors.olderId)}
          >
            &larr; Prev
          </button>
          <button className="btn outline" type="button" onClick={onBack}>
            Posts
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={!neighbors.newerId}
            onClick={() => neighbors.newerId && onNavigate && onNavigate(neighbors.newerId)}
          >
            Next &rarr;
          </button>
      </div>
        {readerSettingsOpen && (
          <div
            className="reader-modal-overlay"
            role="presentation"
            onClick={() => {
              if (typeof onCloseReaderSettings === "function") onCloseReaderSettings();
            }}
          >
            <div
              className="reader-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Reader settings"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="reader-modal-header">
                <h3 className="reader-modal-title">Reader settings</h3>
                <button
                  type="button"
                  className="btn ghost reader-modal-close"
                  onClick={() => {
                    if (typeof onCloseReaderSettings === "function") onCloseReaderSettings();
                  }}
                >
                  Close
                </button>
              </div>
              <div className="reader-controls" role="region" aria-label="Reader settings options">
                <div className="reader-control-group">
                  <span className="reader-control-label">Text size</span>
                  <div className="reader-pill-group" role="group" aria-label="Text size">
                    {READER_TEXT_SCALE_OPTIONS.map((option) => {
                      const isActive = readerSettings.textScale === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`reader-pill${isActive ? " active" : ""}`}
                          onClick={() => updateReaderSetting("textScale", option.value)}
                          aria-pressed={isActive}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="reader-control-group">
                  <span className="reader-control-label">Line spacing</span>
                  <div className="reader-pill-group" role="group" aria-label="Line spacing">
                    {READER_LINE_SPACING_OPTIONS.map((option) => {
                      const isActive = readerSettings.lineSpacing === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`reader-pill${isActive ? " active" : ""}`}
                          onClick={() => updateReaderSetting("lineSpacing", option.value)}
                          aria-pressed={isActive}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="reader-control-group">
                  <span className="reader-control-label">Layout width</span>
                  <div className="reader-pill-group" role="group" aria-label="Layout width">
                    {READER_WIDTH_OPTIONS.map((option) => {
                      const isActive = readerSettings.widthMode === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`reader-pill${isActive ? " active" : ""}`}
                          onClick={() => updateReaderSetting("widthMode", option.value)}
                          aria-pressed={isActive}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="reader-control-group">
                  <span className="reader-control-label">Typeface</span>
                  <div className="reader-pill-group font-grid" role="group" aria-label="Typeface">
                    {READER_TYPEFACE_OPTIONS.map((option) => {
                      const isActive = readerSettings.typeface === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`reader-pill${isActive ? " active" : ""}`}
                            onClick={() => updateReaderSetting("typeface", option.value)}
                          aria-pressed={isActive}
                          style={getTypefacePreviewStyle(option.value)}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="reader-control-group">
                  <span className="reader-control-label">Alignment</span>
                  <div className="reader-pill-group" role="group" aria-label="Text alignment">
                    {READER_ALIGNMENT_OPTIONS.map((option) => {
                      const isActive = readerSettings.textAlign === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`reader-pill${isActive ? " active" : ""}`}
                          onClick={() => updateReaderSetting("textAlign", option.value)}
                          aria-pressed={isActive}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="reader-control-group">
                  <span className="reader-control-label">Paragraph indent</span>
                  <div className="reader-pill-group" role="group" aria-label="Paragraph indent">
                    {READER_INDENT_OPTIONS.map((option) => {
                      const isActive = readerSettings.textIndent === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`reader-pill${isActive ? " active" : ""}`}
                          onClick={() => updateReaderSetting("textIndent", option.value)}
                          aria-pressed={isActive}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <header className="post-header">
          <span className="muted small">{creatorDisplay}</span>
          <h2 className="title">{post.title || post.id}</h2>
          <Timestamp value={post.published} prefix="Published" />
        </header>

        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((item) => (
              <a
                className="tag attachment"
                href={`${MEDIA_BASE}${item.path}`}
                target="_blank"
                rel="noreferrer"
                key={item.path}
              >
                {item.name || item.path.split("/").pop()}
              </a>
            ))}
          </div>
        )}

        {normalizedHtml && <div className="prose" dangerouslySetInnerHTML={{ __html: normalizedHtml }} />}

        {heroImage && (
          <div className="feature-image">
            <img src={heroImage} alt="" />
          </div>
        )}
        <div className="post-nav">
          <button
            className="btn ghost"
            type="button"
            disabled={!neighbors.olderId}
            onClick={() => neighbors.olderId && onNavigate && onNavigate(neighbors.olderId)}
          >
            &larr; Prev
          </button>
          <button className="btn outline" type="button" onClick={onBack}>
            Posts
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={!neighbors.newerId}
            onClick={() => neighbors.newerId && onNavigate && onNavigate(neighbors.newerId)}
          >
            Next &rarr;
          </button>
        </div>
      </article>
    </div>
  );
}

export default PostView;
