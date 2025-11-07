import React, { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

const rawApiBase = import.meta.env.VITE_API_BASE || "/api/proxy/kemono";
const API_BASE = rawApiBase.endsWith("/") ? rawApiBase.slice(0, -1) : rawApiBase;
const MEDIA_BASE = `${API_BASE}/media`;
const API_PAGE_SIZE = 50;
const MAX_SEARCH_RESULTS = 1000;
const MAX_CACHE_POSTS = 1000;
const MAX_CACHE_POST_DETAILS = 100;
const CACHE_VERSION = 1;
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;
const CACHE_PREF_PREFIX = "kemono.cache.pref";
const CACHE_DATA_PREFIX = "kemono.cache";
const PAGE_SIZE_OPTIONS = [25, 50, 75, 100, 125, 150];
const PAGE_SIZE_KEY = "kemono.pageSize";
const READER_TEXT_SCALE_OPTIONS = [
  { value: "small", label: "Small" },
  { value: "base", label: "Default" },
  { value: "large", label: "Large" },
];
const READER_LINE_SPACING_OPTIONS = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "relaxed", label: "Relaxed" },
];
const READER_WIDTH_OPTIONS = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "full", label: "Full" },
];
const READER_TYPEFACE_OPTIONS = [
  { value: false, label: "Sans" },
  { value: true, label: "Serif" },
];
const READER_ALIGNMENT_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "justify", label: "Justify" },
];
const READER_INDENT_OPTIONS = [
  { value: "none", label: "Off" },
  { value: "medium", label: "On" },
];
const READER_TEXT_SCALE_VALUES = READER_TEXT_SCALE_OPTIONS.map((option) => option.value);
const READER_LINE_SPACING_VALUES = READER_LINE_SPACING_OPTIONS.map((option) => option.value);
const READER_WIDTH_VALUES = READER_WIDTH_OPTIONS.map((option) => option.value);
const READER_ALIGNMENT_VALUES = READER_ALIGNMENT_OPTIONS.map((option) => option.value);
const READER_INDENT_VALUES = READER_INDENT_OPTIONS.map((option) => option.value);
const READER_SETTINGS_KEY = "kemono.readerSettings";
const DEFAULT_READER_SETTINGS = {
  textScale: "base",
  lineSpacing: "normal",
  widthMode: "full",
  serifBody: false,
  textAlign: "left",
  textIndent: "none",
};

const SERVICE_LABELS = {
  patreon: "Patreon",
  fanbox: "Pixiv Fanbox",
  fantia: "Fantia",
  discord: "Discord",
  gumroad: "Gumroad",
  dlsite: "DLsite",
};

const RAW_BASE_PATH = (import.meta.env && import.meta.env.BASE_URL) || "/";
const NORMALIZED_BASE_PATH = normalizeBasePath(RAW_BASE_PATH);
const BASE_PATH_PREFIX = NORMALIZED_BASE_PATH === "/" ? "" : NORMALIZED_BASE_PATH.slice(0, -1);
const BASE_TITLE = "Kemono Explorer";

function normalizeBasePath(value) {
  if (typeof value !== "string" || value.length === 0) {
    return "/";
  }
  let next = value.trim();
  if (!next.startsWith("/")) {
    next = `/${next}`;
  }
  if (!next.endsWith("/")) {
    next = `${next}/`;
  }
  return next.replace(/\/{2,}/g, "/");
}

function stripBasePath(pathname) {
  if (typeof pathname !== "string" || pathname.length === 0) {
    return "/";
  }
  if (!BASE_PATH_PREFIX) {
    return pathname || "/";
  }
  if (pathname === BASE_PATH_PREFIX) {
    return "/";
  }
  if (pathname.startsWith(`${BASE_PATH_PREFIX}/`)) {
    const remainder = pathname.slice(BASE_PATH_PREFIX.length);
    return remainder || "/";
  }
  return pathname || "/";
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodePathSegment(value) {
  if (typeof value !== "string") {
    return "";
  }
  return encodeURIComponent(value);
}

function safeString(value) {
  return typeof value === "string" ? value : "";
}

function toNumericCount(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const digits = value.replace(/[^\d]/g, "");
    if (!digits) return null;
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toViewOrNull(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.name === "home") {
    return { name: "home" };
  }
  if (raw.name === "creator") {
    const service = safeString(raw.service);
    const creatorId = safeString(raw.creatorId);
    if (!service || !creatorId) return null;
    return {
      name: "creator",
      service,
      creatorId,
      creatorName: safeString(raw.creatorName),
    };
  }
  if (raw.name === "post") {
    const service = safeString(raw.service);
    const creatorId = safeString(raw.creatorId);
    const postId = safeString(raw.postId);
    if (!service || !creatorId || !postId) return null;
    return {
      name: "post",
      service,
      creatorId,
      creatorName: safeString(raw.creatorName),
      postId,
      postTitle: safeString(raw.postTitle),
    };
  }
  return null;
}

function ensureView(raw) {
  return toViewOrNull(raw) || { name: "home" };
}

function parseViewFromPath(pathname) {
  const stripped = stripBasePath(pathname || "/");
  if (!stripped || stripped === "/") {
    return { name: "home" };
  }
  const segments = stripped.split("/").filter(Boolean).map(decodePathSegment);
  if (segments.length >= 5 && segments[0] === "creator" && segments[3] === "post") {
    return ensureView({
      name: "post",
      service: segments[1],
      creatorId: segments[2],
      creatorName: "",
      postId: segments[4],
    });
  }
  if (segments.length >= 3 && segments[0] === "creator") {
    return ensureView({
      name: "creator",
      service: segments[1],
      creatorId: segments[2],
      creatorName: "",
    });
  }
  return { name: "home" };
}

function getViewFromHistoryState(state, pathname) {
  const fromState = toViewOrNull(state?.view);
  if (fromState) {
    return fromState;
  }
  return parseViewFromPath(pathname);
}

function viewsEqual(a, b) {
  const viewA = ensureView(a);
  const viewB = ensureView(b);
  if (viewA.name !== viewB.name) return false;
  if (viewA.name === "home") return true;
  if (viewA.name === "creator") {
    return (
      viewA.service === viewB.service &&
      viewA.creatorId === viewB.creatorId &&
      viewA.creatorName === viewB.creatorName
    );
  }
  if (viewA.name === "post") {
    return (
      viewA.service === viewB.service &&
      viewA.creatorId === viewB.creatorId &&
      viewA.postId === viewB.postId &&
      viewA.creatorName === viewB.creatorName
    );
  }
  return false;
}

function getUrlForView(view) {
  const normalized = ensureView(view);
  const segments = [];
  if (normalized.name === "creator" || normalized.name === "post") {
    segments.push("creator", normalized.service, normalized.creatorId);
    if (normalized.name === "post") {
      segments.push("post", normalized.postId);
    }
  }
  const encodedSegments = segments.map(encodePathSegment);
  const suffix = encodedSegments.length > 0 ? `/${encodedSegments.join("/")}` : "/";
  return BASE_PATH_PREFIX ? `${BASE_PATH_PREFIX}${suffix}` : suffix;
}

function getTitleForView(view) {
  const normalized = ensureView(view);
  if (normalized.name === "creator") {
    const creatorLabel = normalized.creatorName || normalized.creatorId || "Creator";
    const serviceLabel = SERVICE_LABELS[normalized.service] || normalized.service || "";
    const dynamic = serviceLabel ? `${creatorLabel} (${serviceLabel})` : creatorLabel;
    return `${dynamic} | ${BASE_TITLE}`;
  }
  if (normalized.name === "post") {
    const title = normalized.postTitle || normalized.postId || "Post";
    const creatorLabel = normalized.creatorName || normalized.creatorId || "";
    const serviceLabel = SERVICE_LABELS[normalized.service] || normalized.service || "";
    const creatorPart = creatorLabel
      ? serviceLabel
        ? `${creatorLabel} (${serviceLabel})`
        : creatorLabel
      : serviceLabel;
    const segments = [title];
    if (creatorPart) {
      segments.push(creatorPart);
    }
    segments.push(BASE_TITLE);
    return segments.join(" | ");
  }
  return BASE_TITLE;
}

function getInitialView() {
  if (typeof window === "undefined") {
    return { name: "home" };
  }
  const fromState = toViewOrNull(window.history?.state?.view);
  if (fromState) {
    return fromState;
  }
  return parseViewFromPath(window.location.pathname);
}

function buildHistoryState(view) {
  return { view: { ...ensureView(view) } };
}

function getInitialPageSize() {
  if (typeof window === "undefined" || !window.localStorage) {
    return API_PAGE_SIZE;
  }
  try {
    const stored = parseInt(window.localStorage.getItem(PAGE_SIZE_KEY) || "", 10);
    if (PAGE_SIZE_OPTIONS.includes(stored)) {
      return stored;
    }
  } catch {
    // ignore invalid persisted values
  }
  return API_PAGE_SIZE;
}

function normalizeReaderSettings(raw) {
  const normalized = { ...DEFAULT_READER_SETTINGS };
  if (!raw || typeof raw !== "object") return normalized;
  if (READER_TEXT_SCALE_VALUES.includes(raw.textScale)) {
    normalized.textScale = raw.textScale;
  }
  if (READER_LINE_SPACING_VALUES.includes(raw.lineSpacing)) {
    normalized.lineSpacing = raw.lineSpacing;
  }
  if (READER_WIDTH_VALUES.includes(raw.widthMode)) {
    normalized.widthMode = raw.widthMode;
  }
  if (READER_ALIGNMENT_VALUES.includes(raw.textAlign)) {
    normalized.textAlign = raw.textAlign;
  }
  if (READER_INDENT_VALUES.includes(raw.textIndent)) {
    normalized.textIndent = raw.textIndent;
  }
  if (raw.serifBody === true || raw.serifBody === false) {
    normalized.serifBody = raw.serifBody;
  } else if (raw.serifBody === "true") {
    normalized.serifBody = true;
  } else if (raw.serifBody === "false") {
    normalized.serifBody = false;
  }
  return normalized;
}

function getInitialReaderSettings() {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...DEFAULT_READER_SETTINGS };
  }
  try {
    const stored = window.localStorage.getItem(READER_SETTINGS_KEY);
    if (!stored) return { ...DEFAULT_READER_SETTINGS };
    const parsed = JSON.parse(stored);
    return normalizeReaderSettings(parsed);
  } catch {
    return { ...DEFAULT_READER_SETTINGS };
  }
}

function getCachePreferenceKey(service, creatorId) {
  return `${CACHE_PREF_PREFIX}.${service}.${creatorId}`;
}

function getCacheDataKey(service, creatorId) {
  return `${CACHE_DATA_PREFIX}.${service}.${creatorId}`;
}

function readBooleanPreference(key, fallback = false) {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    // ignore persistence issues
  }
  return fallback;
}

function loadCreatorCache(service, creatorId) {
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
        }
      });
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCreatorCache(service, creatorId, data) {
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

function isCacheFresh(cache) {
  if (!cache || typeof cache.updatedAt !== "number") return false;
  return Date.now() - cache.updatedAt < CACHE_MAX_AGE_MS;
}

function pruneCacheChunks(chunks) {
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

function pruneCachePostDetails(details) {
  if (!details) return undefined;
  const entries = Object.entries(details)
    .map(([postId, value]) => ({
      postId,
      data: value?.data,
      updatedAt: typeof value?.updatedAt === "number" ? value.updatedAt : 0,
    }))
    .filter((entry) => entry.data)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const pruned = {};
  entries.slice(0, MAX_CACHE_POST_DETAILS).forEach((entry) => {
    pruned[entry.postId] = { data: entry.data, updatedAt: entry.updatedAt || Date.now() };
  });
  return pruned;
}

function collectCachedPosts(cache) {
  if (!cache || !cache.chunks) return null;
  const entries = Object.entries(cache.chunks)
    .map(([offset, value]) => ({ offset: Number(offset), value: Array.isArray(value) ? value : [] }))
    .filter((entry) => entry.value.length > 0)
    .sort((a, b) => a.offset - b.offset);
  if (!entries.length) return null;
  const posts = [];
  for (const entry of entries) {
    posts.push(...entry.value);
    if (entry.value.length < API_PAGE_SIZE) break;
    if (posts.length >= MAX_CACHE_POSTS) break;
  }
  return posts.length ? posts.slice(0, MAX_CACHE_POSTS) : null;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: { Accept: "text/css" } });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error("fetchJson failed", error);
    return null;
  }
}

function getServiceLabel(service) {
  if (!service) return "";
  const key = String(service).toLowerCase();
  if (SERVICE_LABELS[key]) return SERVICE_LABELS[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function formatDate(ts) {
  if (!ts) return { date: "-", time: "" };
  try {
    const d = new Date(ts);
    const locale =
      typeof navigator !== "undefined"
        ? navigator.languages?.[0] || navigator.language || "en-GB"
        : "en-GB";
    const dateFormatter = new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const timeFormatter = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return { date: dateFormatter.format(d), time: timeFormatter.format(d) };
  } catch {
    return { date: typeof ts === "string" ? ts : "—", time: "" };
  }
}

function Timestamp({ value, prefix }) {
  const { date, time } = formatDate(value);
  if (!date) return null;
  const label = typeof prefix === "string" ? prefix.trim() : "";
  return (
    <span className="timestamp">
      {label ? <span className="timestamp-label">{label}</span> : null}
      <span className="timestamp-date">{date}</span>
      {time ? <span className="timestamp-time">{time}</span> : null}
    </span>
  );
}

function escapeHtml(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getPostExcerptHtml(post) {
  if (!post) return null;
  const substring = typeof post.substring === "string" ? post.substring.trim() : "";
  if (substring) return substring;

  const candidateSources = [post.excerpt, post.snippet, post.summary, post.match, post.content, post.body, post.text];
  for (const source of candidateSources) {
    if (!source) continue;

    if (typeof source === "string") {
      const trimmedSource = source.trim();
      if (!trimmedSource) continue;
      const plain = trimmedSource.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (!plain) continue;
      const limit = 240;
      const snippet = plain.length > limit ? `${plain.slice(0, limit).trimEnd()}...` : plain;
      return escapeHtml(snippet);
    }

    if (typeof source === "object") {
      const stringValues = Object.values(source)
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean);
      if (!stringValues.length) continue;
      const combined = stringValues.join(" ");
      const plain = combined.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (!plain) continue;
      const limit = 240;
      const snippet = plain.length > limit ? `${plain.slice(0, limit).trimEnd()}...` : plain;
      return escapeHtml(snippet);
    }
  }

  return null;
}

function extractTagTokens(value) {
  return String(value || "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function App() {
  const [view, setViewState] = useState(getInitialView);
  const viewRef = useRef(view);
  const initialViewRef = useRef(view);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const navigate = useCallback((nextView, options = {}) => {
    const normalized = ensureView(nextView);
    const previous = viewRef.current;
    setViewState(normalized);
    viewRef.current = normalized;

    if (typeof window === "undefined" || options.skipHistory) {
      return normalized;
    }

    const sameView = viewsEqual(normalized, previous);
    const url = getUrlForView(normalized);
    const state = buildHistoryState(normalized);

    try {
      if (options.replace || sameView) {
        window.history.replaceState(state, "", url);
      } else {
        window.history.pushState(state, "", url);
      }
    } catch (error) {
      console.warn("Failed to update browser history", error);
    }

    return normalized;
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = getTitleForView(view);
  }, [view]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const initialView = ensureView(initialViewRef.current);
    try {
      const url = getUrlForView(initialView);
      window.history.replaceState(buildHistoryState(initialView), "", url);
    } catch (error) {
      console.warn("Failed to initialize browser history", error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = (event) => {
      const next = getViewFromHistoryState(event.state, window.location.pathname);
      navigate(next, { skipHistory: true });
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [navigate]);

  const [savedCreators, setSavedCreators] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("kemono.savedCreators") || "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("kemono.savedCreators", JSON.stringify(savedCreators));
  }, [savedCreators]);

  const [creatorFilters, setCreatorFilters] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("kemono.creatorFilters") || "{}");
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("kemono.creatorFilters", JSON.stringify(creatorFilters));
    } catch {
      // ignore
    }
  }, [creatorFilters]);

  const getInitialThemeMode = () => {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem("kemono.theme");
      if (stored === "light" || stored === "dark" || stored === "auto") return stored;
    }
    return "auto";
  };

  const [themeMode, setThemeMode] = useState(getInitialThemeMode);
  const [systemTheme, setSystemTheme] = useState(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  });
  const [readerSettingsOpen, setReaderSettingsOpen] = useState(false);
  const activeTheme = themeMode === "auto" ? systemTheme : themeMode;

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", activeTheme);
  }, [activeTheme]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem("kemono.theme", themeMode);
    }
  }, [themeMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event) => setSystemTheme(event.matches ? "dark" : "light");
    setSystemTheme(media.matches ? "dark" : "light");
    if (media.addEventListener) {
      media.addEventListener("change", handleChange);
    } else {
      media.addListener(handleChange);
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener("change", handleChange);
      } else {
        media.removeListener(handleChange);
      }
    };
  }, []);

  useEffect(() => {
    if (view.name !== "post" && readerSettingsOpen) {
      setReaderSettingsOpen(false);
    }
  }, [view, readerSettingsOpen]);

  const handleResolvePostTitle = useCallback(
    (resolvedTitle) => {
      if (view.name !== "post") return;
      const title = typeof resolvedTitle === "string" ? resolvedTitle : "";
      navigate(
        {
          name: "post",
          service: view.service,
          creatorId: view.creatorId,
          creatorName: view.creatorName,
          postId: view.postId,
          postTitle: title,
        },
        { replace: true },
      );
    },
    [navigate, view.name, view.service, view.creatorId, view.creatorName, view.postId],
  );

  const openCreator = (service, creatorId, creatorName) => {
    navigate({ name: "creator", service, creatorId, creatorName });
  };

  const openPost = (service, creatorId, creatorName, postId, postTitle) => {
    navigate({ name: "post", service, creatorId, creatorName, postId, postTitle });
  };

  const isCreatorSaved = (service, creatorId) =>
    savedCreators.some((c) => c.service === service && c.id === creatorId);

  const getCreatorFilter = (service, creatorId) => {
    if (!service || !creatorId) return "";
    const key = `${service}:${creatorId}`;
    const value = creatorFilters[key];
    return typeof value === "string" ? value : "";
  };

  const updateCreatorFilter = (service, creatorId, value) => {
    const key = `${service}:${creatorId}`;
    const trimmed = typeof value === "string" ? value.trim() : "";
    setCreatorFilters((prev) => {
      const next = { ...prev };
      if (trimmed) {
        next[key] = trimmed;
      } else {
        delete next[key];
      }
      return next;
    });
  };

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="header-top">
            <h1 className="title">
              <button className="brand-link" type="button" onClick={() => navigate({ name: "home" })}>
                Kemono Explorer
              </button>
            </h1>
            {view.name === "post" && (
              <button
                type="button"
                className="btn ghost reader-settings-button header-reader-button"
                onClick={() => setReaderSettingsOpen(true)}
              >
                Reader settings
              </button>
            )}
            <div className="theme-switcher">
              <label className="theme-label" htmlFor="theme-select">
                Theme
              </label>
              <select
                id="theme-select"
                className="theme-select"
                value={themeMode}
                onChange={(event) => setThemeMode(event.target.value)}
              >
                <option value="auto">Auto</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
          </div>
          <p className="muted">
            Browse kemono.cr with a tidy reader. Save creators you follow, scan their latest posts, and dive into content without leaving the page.
          </p>
        </div>
      </header>

      <div className="app-shell">
        <main className="app-main">
          {view.name === "home" && (
            <Home
              savedCreators={savedCreators}
              onSaveCreator={(entry) =>
                setSavedCreators((prev) => {
                  const exists = prev.find((c) => c.service === entry.service && c.id === entry.id);
                  return exists ? prev : [...prev, entry];
                })
              }
              onRenameCreator={(entry) =>
                setSavedCreators((prev) =>
                  prev.map((c) => {
                    if (c.service !== entry.service || c.id !== entry.id) return c;
                    const nextName = typeof entry.name === "string" ? entry.name.trim() : "";
                    return { ...c, name: nextName };
                  })
                )
              }
              onRemoveCreator={(service, id) => {
                updateCreatorFilter(service, id, "");
                setSavedCreators((prev) => prev.filter((c) => !(c.service === service && c.id === id)));
              }}
              onOpenCreator={openCreator}
            />
          )}

          {view.name === "creator" && (
            <CreatorPage
              service={view.service}
              creatorId={view.creatorId}
              creatorName={view.creatorName}
              alreadySaved={isCreatorSaved(view.service, view.creatorId)}
              onOpenPost={(postId, postTitle) =>
                openPost(view.service, view.creatorId, view.creatorName, postId, postTitle)
              }
              onSave={() =>
                setSavedCreators((prev) => {
                  const exists = prev.find((c) => c.service === view.service && c.id === view.creatorId);
                  if (exists) return prev;
                  return [
                    ...prev,
                    { service: view.service, id: view.creatorId, name: view.creatorName || view.creatorId },
                  ];
                })
              }
              activeFilter={getCreatorFilter(view.service, view.creatorId)}
              onUpdateFilter={(value) => updateCreatorFilter(view.service, view.creatorId, value)}
            />
          )}

          {view.name === "post" && (
            <PostView
              service={view.service}
              creatorId={view.creatorId}
              creatorName={view.creatorName}
              postId={view.postId}
              activeFilter={getCreatorFilter(view.service, view.creatorId)}
              readerSettingsOpen={readerSettingsOpen}
              onCloseReaderSettings={() => setReaderSettingsOpen(false)}
              onBack={() =>
                navigate({
                  name: "creator",
                  service: view.service,
                  creatorId: view.creatorId,
                  creatorName: view.creatorName,
                })
              }
              onNavigate={(nextPostId) =>
                navigate({
                  name: "post",
                  service: view.service,
                  creatorId: view.creatorId,
                  creatorName: view.creatorName,
                  postId: nextPostId,
                })
              }
              onResolvePostTitle={handleResolvePostTitle}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function Home({ savedCreators, onSaveCreator, onRenameCreator, onRemoveCreator, onOpenCreator }) {
  const [service, setService] = useState("patreon");
  const [creatorId, setCreatorId] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [editingCreator, setEditingCreator] = useState(null);
  const [editingName, setEditingName] = useState("");

  const handleSave = (event) => {
    event.preventDefault();
    const id = creatorId.trim();
    if (!id) return;
    onSaveCreator({ service, id, name: creatorName.trim() });
    setCreatorId("");
    setCreatorName("");
  };

  const beginRename = (creator) => {
    setEditingCreator({ service: creator.service, id: creator.id });
    setEditingName(creator.name || "");
  };

  const cancelRename = () => {
    setEditingCreator(null);
    setEditingName("");
  };

  const handleRenameSubmit = (event) => {
    event.preventDefault();
    if (!editingCreator) return;
    onRenameCreator({
      service: editingCreator.service,
      id: editingCreator.id,
      name: editingName.trim(),
    });
    setEditingCreator(null);
    setEditingName("");
  };

  const handleOpen = (event) => {
    event.preventDefault();
    const id = creatorId.trim();
    if (!id) return;
    onOpenCreator(service, id, creatorName.trim());
  };

  return (
    <div className="section-grid">
      <section className="card">
        <div className="card-row header-row">
          <div className="card-col">
            <h2 className="title">Saved creators</h2>
            <span className="label">
              {savedCreators.length > 0 ? `${savedCreators.length} saved` : "Nothing saved yet"}
            </span>
          </div>
        </div>

        <ul className="list">
          {savedCreators.map((c) => (
            <li className="list-item" key={`${c.service}-${c.id}`}>
              {editingCreator && editingCreator.service === c.service && editingCreator.id === c.id ? (
                <form className="list-edit" onSubmit={handleRenameSubmit}>
                  <input
                    className="input list-edit-input"
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    placeholder="Display name"
                    autoFocus
                  />
                  <div className="list-actions">
                    <button className="btn subtle" type="button" onClick={cancelRename}>
                      Cancel
                    </button>
                    <button className="btn primary" type="submit">
                      Save
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="list-details">
                    <button className="link list-title" onClick={() => onOpenCreator(c.service, c.id, c.name)}>
                      {c.name || c.id}
                    </button>
                    <span className="muted small">
                      {c.service} - {c.id}
                    </span>
                  </div>
                  <div className="list-actions">
                    <button className="btn subtle" type="button" onClick={() => beginRename(c)}>
                      Rename
                    </button>
                    <button className="btn subtle" type="button" onClick={() => onRemoveCreator(c.service, c.id)}>
                      Remove
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
          {savedCreators.length === 0 && <li className="muted empty-state">Save creators to keep them handy.</li>}
        </ul>
      </section>

      <section className="card">
        <div className="card-row header-row">
          <div className="card-col">
            <h2 className="title">Open a creator</h2>
            <span className="label">Use a service + creator ID straight from kemono</span>
          </div>
        </div>

        <form className="form-grid" onSubmit={handleSave}>
          <label className="field">
            <span className="label">Service</span>
            <select className="input" value={service} onChange={(event) => setService(event.target.value)}>
              <option value="patreon">Patreon</option>
              <option value="fanbox">Fanbox</option>
              <option value="fantia">Fantia</option>
              <option value="discord">Discord</option>
              <option value="gumroad">Gumroad</option>
              <option value="dlsite">DLsite</option>
            </select>
          </label>

          <label className="field">
            <span className="label">Creator ID</span>
            <input
              className="input"
              value={creatorId}
              onChange={(event) => setCreatorId(event.target.value)}
              placeholder="e.g. 48003713"
            />
          </label>

          <label className="field">
            <span className="label">Display name</span>
            <input
              className="input"
              value={creatorName}
              onChange={(event) => setCreatorName(event.target.value)}
              placeholder="Optional label"
            />
          </label>

          <div className="form-actions">
            <button className="btn" type="button" onClick={handleOpen}>
              Open without saving
            </button>
            <button className="btn primary" type="submit">
              Save creator
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

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
      if (key === "serifBody") {
        const nextValue = Boolean(value);
        if (prev.serifBody === nextValue) {
          return prev;
        }
        return { ...prev, serifBody: nextValue };
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

  const bodyHtml = post.content || post.body || post.text || "";
  const normalizedHtml = bodyHtml
    ? bodyHtml.replace(/src=(["'])\/(?!\/)/gi, 'src=$1https://kemono.cr/')
    : "";
  const heroImage = post.file?.path ? `${MEDIA_BASE}${post.file.path}` : null;
  const attachments = Array.isArray(post.attachments) ? post.attachments : [];
  const readerCardClassName = [
    "card post-card",
    `reader-width-${readerSettings.widthMode}`,
    `reader-scale-${readerSettings.textScale}`,
    `reader-leading-${readerSettings.lineSpacing}`,
    `reader-align-${readerSettings.textAlign}`,
    `reader-indent-${readerSettings.textIndent}`,
    readerSettings.serifBody ? "reader-serif" : null,
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
                  <div className="reader-pill-group" role="group" aria-label="Typeface">
                    {READER_TYPEFACE_OPTIONS.map((option) => {
                      const isActive = readerSettings.serifBody === option.value;
                      return (
                        <button
                          key={String(option.value)}
                          type="button"
                          className={`reader-pill${isActive ? " active" : ""}`}
                          onClick={() => updateReaderSetting("serifBody", option.value)}
                          aria-pressed={isActive}
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
export default App;
