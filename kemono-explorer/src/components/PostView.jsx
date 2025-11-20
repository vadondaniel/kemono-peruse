import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import Timestamp from "./Timestamp.jsx";
import {
  API_BASE,
  API_PAGE_SIZE,
  CACHE_VERSION,
  MEDIA_BASE,
  READER_ALIGNMENT_OPTIONS,
  READER_ALIGNMENT_VALUES,
  READER_ATTACHMENT_LINK_OPTIONS,
  READER_ATTACHMENT_LINK_VALUES,
  READER_INDENT_OPTIONS,
  READER_INDENT_VALUES,
  READER_LINE_SPACING_OPTIONS,
  READER_LINE_SPACING_VALUES,
  READER_SETTINGS_KEY,
  READER_TEXT_SCALE_OPTIONS,
  READER_TEXT_SCALE_VALUES,
  READER_TYPEFACE_OPTIONS,
  READER_TYPEFACE_VALUES,
  READER_WIDTH_OPTIONS,
  READER_WIDTH_VALUES,
  ORIGINAL_MEDIA_BASE,
} from "../constants.js";
import { fetchJson } from "../utils/api.js";
import { getCachePreferenceKey, loadCreatorCache, writeCreatorCache, isCacheFresh, pruneCacheChunks, pruneCachePostDetails } from "../utils/cache.js";
import { extractTagTokens, getServiceLabel, normalizePostHtml } from "../utils/posts.js";
import { getInitialReaderSettings, getTypefacePreviewStyle, readBooleanPreference } from "../utils/preferences.js";
import { getUrlForView } from "../utils/navigation.js";

const sanitizeAttachmentPath = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const normalizeAttachmentItem = (item) => {
  if (!item || typeof item !== "object") return null;
  const path = sanitizeAttachmentPath(item.path);
  const server = typeof item.server === "string" ? item.server.trim() : null;
  const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : path?.split("/").pop() || "";
  const original =
    typeof item.original === "string"
      ? item.original
      : server && path
        ? `${server}${path}`
        : null;
  const url = typeof item.url === "string" ? item.url : null;
  return { ...item, name, path, original: original || null, url };
};

const mergeAttachmentLists = (primary, extras) => {
  const seen = new Set();
  const result = [];
  const push = (entry) => {
    const normalized = normalizeAttachmentItem(entry);
    if (!normalized) return;
    const key = normalized.path || `${normalized.name || ""}|${normalized.original || normalized.url || ""}`;
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    result.push(normalized);
  };
  if (Array.isArray(primary)) {
    primary.forEach(push);
  }
  if (Array.isArray(extras)) {
    extras.forEach(push);
  }
  return result;
};

const normalizePostPayload = (payload) => {
  if (!payload || typeof payload !== "object") return null;
  if (payload.post) {
    return {
      ...payload.post,
      attachments: mergeAttachmentLists(payload.post.attachments, payload.attachments),
    };
  }
  return {
    ...payload,
    attachments: mergeAttachmentLists(payload.attachments, null),
  };
};

const normalizeCachedPost = (postData) => {
  if (!postData || typeof postData !== "object") return null;
  if (Array.isArray(postData.attachments)) {
    return { ...postData, attachments: mergeAttachmentLists(postData.attachments, null) };
  }
  return { ...postData, attachments: [] };
};

const sanitizeAttachmentKey = (value) => {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase();
};

const stripFileExtension = (value) => {
  if (typeof value !== "string") return "";
  const index = value.lastIndexOf(".");
  if (index <= 0) return value;
  return value.slice(0, index);
};

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
      if (key === "attachmentsMode") {
        if (!READER_ATTACHMENT_LINK_VALUES.includes(value) || prev.attachmentsMode === value) {
          return prev;
        }
        return { ...prev, attachmentsMode: value };
      }
      return prev;
    });
  };

  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [neighbors, setNeighbors] = useState({ newerId: null, olderId: null });
  const [heroLoaded, setHeroLoaded] = useState(false);
  const [attachmentsExpanded, setAttachmentsExpanded] = useState(false);
  const serviceLabel = getServiceLabel(service);
  const creatorLabel = creatorName || creatorId || "";
  const creatorDisplay = creatorLabel
    ? serviceLabel
      ? `${creatorLabel} (${serviceLabel})`
      : creatorLabel
    : serviceLabel;
  const lastResolvedTitleRef = useRef(null);
  const proseRef = useRef(null);
  useEffect(() => {
    if (!post || typeof onResolvePostTitle !== "function") return;
    const nextTitle = post.title || post.id || "";
    if (lastResolvedTitleRef.current === nextTitle) return;
    lastResolvedTitleRef.current = nextTitle;
    onResolvePostTitle(nextTitle);
  }, [post, onResolvePostTitle]);
  useEffect(() => {
    setAttachmentsExpanded(false);
  }, [postId]);
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
      setPost(normalizeCachedPost(cachedEntry.data));
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
      const nextPost = normalizePostPayload(data);
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

  const useOriginalAttachments = readerSettings.attachmentsMode === "original";
  const heroFile = post?.file && (post.file.path || post.file.url || post.file.name) ? post.file : null;
  const heroProxySrc = heroFile?.path ? `${MEDIA_BASE}${heroFile.path}` : null;
  const heroOriginalSrc = heroFile?.url || (heroFile?.path ? `${ORIGINAL_MEDIA_BASE}${heroFile.path}` : null);
  const heroImage = heroFile
    ? useOriginalAttachments && heroOriginalSrc
      ? heroOriginalSrc
      : heroProxySrc || heroOriginalSrc
    : null;

  useEffect(() => {
    setHeroLoaded(!heroImage);
  }, [heroImage]);

  const baseAttachments = Array.isArray(post?.attachments) ? [...post.attachments] : [];
  const attachmentMediaBase = useOriginalAttachments ? ORIGINAL_MEDIA_BASE : MEDIA_BASE;
  const attachments = heroFile
    ? [
        {
          ...heroFile,
          path: heroFile.path || heroFile.file || null,
          original: heroOriginalSrc || heroFile.original || heroFile.url || null,
          name: heroFile.name || heroFile.title || "Feature image",
          __heroAttachment: true,
        },
        ...baseAttachments,
      ]
    : baseAttachments;
  const bodyHtml = post?.content || post?.body || post?.text || "";

  const normalizedHtml = bodyHtml
    ? normalizePostHtml(bodyHtml, { service: post?.service || service, attachments, mediaBase: attachmentMediaBase })
    : "";

  const [processedHtml, setProcessedHtml] = useState(() => normalizedHtml || "");

  useEffect(() => {
    setProcessedHtml(normalizedHtml || "");
  }, [normalizedHtml]);

  useLayoutEffect(() => {
    if (!processedHtml) return undefined;
    if (typeof window === "undefined" || typeof window.MutationObserver === "undefined") return undefined;
    const container = proseRef.current;
    if (!container) return undefined;

    const listenerMap = new Map();

    const ensurePlaceholder = (wrapper) => {
      if (wrapper.querySelector(".image-placeholder")) return;
      const placeholder = document.createElement("span");
      placeholder.className = "image-placeholder inline-image-placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      wrapper.insertBefore(placeholder, wrapper.firstChild || null);
    };

    const ensureWrapper = (img) => {
      const picture = img.closest("picture");
      const target = picture || img;
      if (!target || !target.parentNode) return null;
      const existing = target.closest(".inline-image-wrapper");
      if (existing) {
        ensurePlaceholder(existing);
        return existing;
      }
      const wrapper = document.createElement("span");
      wrapper.className = "inline-image-wrapper";
      ensurePlaceholder(wrapper);
      target.parentNode.insertBefore(wrapper, target);
      wrapper.appendChild(target);
      return wrapper;
    };

    const getSignature = (img) => {
      const srcAttr = img.getAttribute("src") || "";
      const srcsetAttr = img.getAttribute("srcset") || "";
      const currentSrc = img.currentSrc || img.src || "";
      return `${currentSrc}|${srcAttr}|${srcsetAttr}`;
    };

    const cleanupImage = (img) => {
      const cleanup = listenerMap.get(img);
      if (cleanup) {
        cleanup();
        listenerMap.delete(img);
      }
      if (img?.dataset) {
        delete img.dataset.inlinePlaceholderSig;
      }
    };

    const bindImage = (img) => {
      if (!(img instanceof HTMLImageElement)) return;
      const wrapper = ensureWrapper(img);
      if (!wrapper) return;

      const previousSignature = img.dataset?.inlinePlaceholderSig || "";
      const nextSignature = getSignature(img);
      const signatureChanged = previousSignature !== nextSignature;
      if (img.dataset) {
        img.dataset.inlinePlaceholderSig = nextSignature;
      }

      if (!signatureChanged && listenerMap.has(img)) {
        return;
      }

      const existingCleanup = listenerMap.get(img);
      if (existingCleanup) {
        existingCleanup();
        listenerMap.delete(img);
      }

      if (!img.hasAttribute("loading")) {
        img.setAttribute("loading", "lazy");
      }

      const alreadyLoaded = img.complete && img.naturalWidth > 0 && !signatureChanged;
      if (alreadyLoaded) {
        wrapper.classList.add("inline-image-loaded");
        return;
      }

      wrapper.classList.remove("inline-image-loaded");

      let settled = false;
      function handleLoad() {
        settle();
      }
      function handleError() {
        settle();
      }
      function removeListeners() {
        img.removeEventListener("load", handleLoad);
        img.removeEventListener("error", handleError);
      }
      function settle() {
        if (settled) return;
        settled = true;
        removeListeners();
        listenerMap.delete(img);
        wrapper.classList.add("inline-image-loaded");
      }

      img.addEventListener("load", handleLoad);
      img.addEventListener("error", handleError);

      if (typeof img.decode === "function") {
        img.decode().then(handleLoad).catch(handleError);
      }

      listenerMap.set(img, removeListeners);
    };

    const collectImages = (node) => {
      const images = [];
      if (!node || node.nodeType !== 1) {
        return images;
      }
      if (node.tagName === "IMG") {
        images.push(node);
      }
      node.querySelectorAll?.("img").forEach((img) => {
        images.push(img);
      });
      return images;
    };

    const buildLocalPostHref = (postId) => {
      if (!postId || !service || !creatorId) return null;
      const path = getUrlForView({ name: "post", service, creatorId, postId });
      if (!path) return null;
      if (typeof window !== "undefined" && window.location?.origin) {
        return `${window.location.origin}${path}`;
      }
      return path;
    };

    const serviceKey = typeof service === "string" ? service.toLowerCase() : "";

    const attachmentLookup = new Map();
    const addAttachmentKey = (rawKey, attachment) => {
      const key = sanitizeAttachmentKey(rawKey);
      if (!key || !attachment || attachmentLookup.has(key)) return;
      attachmentLookup.set(key, attachment);
    };
    const addAttachmentKeyVariants = (rawKey, attachment) => {
      if (!rawKey) return;
      addAttachmentKey(rawKey, attachment);
      const base = stripFileExtension(rawKey);
      if (base && base !== rawKey) {
        addAttachmentKey(base, attachment);
      }
    };
    if (serviceKey === "fanbox" && Array.isArray(attachments)) {
      attachments.forEach((attachment) => {
        if (!attachment) return;
        if (typeof attachment.name === "string") {
          addAttachmentKeyVariants(attachment.name, attachment);
        }
        if (typeof attachment.path === "string") {
          const pathEnd = attachment.path.includes("/") ? attachment.path.split("/").pop() : attachment.path;
          addAttachmentKeyVariants(pathEnd, attachment);
        }
        if (typeof attachment.original === "string") {
          try {
            const url = new URL(attachment.original, window.location.origin);
            const parts = url.pathname.split("/").filter(Boolean);
            if (parts.length > 0) {
              const fileName = parts[parts.length - 1];
              addAttachmentKeyVariants(fileName, attachment);
            }
          } catch {
            // ignore URL parse failures
          }
        }
        if (typeof attachment.stem === "string") {
          addAttachmentKey(attachment.stem, attachment);
        }
      });
    }

    const resolveAttachmentHref = (attachment) => {
      if (!attachment) return null;
      const proxiedHref = attachment?.path ? `${MEDIA_BASE}${attachment.path}` : null;
      const originalHrefCandidates = [
        typeof attachment?.original === "string" ? attachment.original : null,
        typeof attachment?.url === "string" ? attachment.url : null,
        attachment?.path ? `${ORIGINAL_MEDIA_BASE}${attachment.path}` : null,
      ].filter(Boolean);
      const originalHref = originalHrefCandidates[0] || null;
      return useOriginalAttachments ? originalHref || proxiedHref : proxiedHref || originalHref;
    };

    const resolvePatreonPostUrl = (href) => {
      if (!href) return null;
      let url;
      try {
        url = new URL(href, window.location.origin);
      } catch {
        return null;
      }
      const hostname = url.hostname.toLowerCase();
      if (!hostname.endsWith("patreon.com")) return null;
      const segments = url.pathname.split("/").filter(Boolean);
      const postsIndex = segments.indexOf("posts");
      if (postsIndex === -1 || postsIndex >= segments.length - 1) {
        return null;
      }
      const rawSegment = (segments[postsIndex + 1] || "").replace(/\/+$/, "");
      const matches = rawSegment.match(/\d+/g);
      if (!matches || matches.length === 0) return null;
      const postId = matches[matches.length - 1];
      return buildLocalPostHref(postId);
    };

    const resolveFanboxPostUrl = (href) => {
      if (!href) return null;
      let url;
      try {
        url = new URL(href, window.location.origin);
      } catch {
        return null;
      }
      const hostname = url.hostname.toLowerCase();
      if (!hostname.endsWith("fanbox.cc")) return null;
      const segments = url.pathname.split("/").filter(Boolean);
      const postsIndex = segments.indexOf("posts");
      if (postsIndex === -1 || postsIndex >= segments.length - 1) {
        return null;
      }
      const rawSegment = (segments[postsIndex + 1] || "").replace(/\/+$/, "");
      const postIdMatch = rawSegment.match(/\d+/);
      if (!postIdMatch) return null;
      const postId = postIdMatch[0];
      return buildLocalPostHref(postId);
    };

    const resolveFanboxDownloadUrl = (href, anchor) => {
      if (!href || serviceKey !== "fanbox") return null;
      let url;
      try {
        url = new URL(href, window.location.origin);
      } catch {
        return null;
      }
      const hostname = url.hostname.toLowerCase();
      if (!hostname.endsWith("fanbox.cc")) return null;
      if (!url.pathname.includes("/files/")) return null;
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length === 0) return null;
      const filename = segments[segments.length - 1];
      if (!filename) return null;
      let attachment = attachmentLookup.get(sanitizeAttachmentKey(filename));
      if (!attachment && anchor) {
        const label = anchor.textContent || "";
        const labelKey = sanitizeAttachmentKey(label);
        if (labelKey) {
          attachment = attachmentLookup.get(labelKey);
        }
      }
      if (!attachment) return null;
      return resolveAttachmentHref(attachment);
    };

    const resolveInlinePostHref = (href, anchor) => {
      if (!href) return null;
      if (serviceKey === "patreon") {
        return resolvePatreonPostUrl(href);
      }
      if (serviceKey === "fanbox") {
        return resolveFanboxPostUrl(href) || resolveFanboxDownloadUrl(href, anchor);
      }
      return null;
    };

    const rewriteAnchor = (anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const resolvedHref = resolveInlinePostHref(anchor.getAttribute("href") || "", anchor);
      if (!resolvedHref) {
        if (anchor.dataset) {
          delete anchor.dataset.inlinePostLink;
        }
        return;
      }
      if (anchor.getAttribute("href") !== resolvedHref) {
        anchor.setAttribute("href", resolvedHref);
      }
      if (anchor.dataset) {
        anchor.dataset.inlinePostLink = "true";
      }
    };

    const collectAnchors = (node) => {
      const anchors = [];
      if (!node || node.nodeType !== 1) {
        return anchors;
      }
      if (node.tagName === "A") {
        anchors.push(node);
      }
      node.querySelectorAll?.("a").forEach((anchor) => {
        anchors.push(anchor);
      });
      return anchors;
    };

    collectImages(container).forEach(bindImage);
    collectAnchors(container).forEach(rewriteAnchor);

    const observer = new window.MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            collectImages(node).forEach(bindImage);
            collectAnchors(node).forEach(rewriteAnchor);
          });
          mutation.removedNodes.forEach((node) => {
            collectImages(node).forEach((img) => {
              if (container.contains(img)) return;
              cleanupImage(img);
            });
          });
        } else if (mutation.type === "attributes") {
          const target = mutation.target;
          if (target instanceof HTMLImageElement) {
            bindImage(target);
          } else if (target instanceof HTMLAnchorElement && mutation.attributeName === "href") {
            rewriteAnchor(target);
          }
        }
      });
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset", "href"],
    });

    return () => {
      observer.disconnect();
      Array.from(listenerMap.keys()).forEach((img) => {
        cleanupImage(img);
      });
      listenerMap.clear();
    };
  }, [processedHtml, service, creatorId, attachments, useOriginalAttachments]);

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
                <div className="reader-control-group">
                  <span className="reader-control-label">Attachment links</span>
                  <div className="reader-pill-group" role="group" aria-label="Attachment links">
                    {READER_ATTACHMENT_LINK_OPTIONS.map((option) => {
                      const isActive = readerSettings.attachmentsMode === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`reader-pill${isActive ? " active" : ""}`}
                          onClick={() => updateReaderSetting("attachmentsMode", option.value)}
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
          <div className="post-title-row">
            <h2 className="title">{post.title || post.id}</h2>
            {attachments.length > 0 && (
              <button
                type="button"
                className="btn ghost attachment-count-toggle"
                aria-expanded={attachmentsExpanded}
                onClick={() => setAttachmentsExpanded((prev) => !prev)}
              >
                {attachments.length} {attachmentsExpanded ? "\u25BC" : "\u25B6"}
              </button>
            )}
          </div>
          <Timestamp value={post.published} prefix="Published" />
        </header>

        {attachments.length > 0 && attachmentsExpanded && (
          <section className="attachments-panel">
            <div className="attachments">
              {attachments.map((item, index) => {
                const proxiedHref = item?.path ? `${MEDIA_BASE}${item.path}` : null;
                const originalHrefCandidates = [
                  typeof item?.original === "string" ? item.original : null,
                  typeof item?.url === "string" ? item.url : null,
                  item?.path ? `${attachmentMediaBase}${item.path}` : null,
                ].filter(Boolean);
                const href =
                  useOriginalAttachments && originalHrefCandidates.length
                    ? originalHrefCandidates[0]
                    : proxiedHref || originalHrefCandidates[0] || "#";
                const attachmentKey =
                  item?.path || item?.original || item?.name || String(item?.id ?? `attachment-${index}`);
                const label = item?.name || (item?.path ? item.path.split("/").pop() : originalHref) || "Attachment";
                return (
                  <a className="tag attachment" href={href} target="_blank" rel="noreferrer" key={attachmentKey}>
                    {label}
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {processedHtml && <div className="prose" ref={proseRef} dangerouslySetInnerHTML={{ __html: processedHtml }} />}

        {heroImage && (
          <div className="feature-image">
            {!heroLoaded && <div className="image-placeholder" aria-hidden="true" />}
            <img
              src={heroImage}
              alt=""
              className={heroLoaded ? "image-loaded" : ""}
              onLoad={() => setHeroLoaded(true)}
              onError={() => setHeroLoaded(true)}
            />
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
