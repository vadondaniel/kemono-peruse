import React, { useEffect, useRef, useState } from "react";
import "./App.css";

const rawApiBase = import.meta.env.VITE_API_BASE || "/api/proxy/kemono";
const API_BASE = rawApiBase.endsWith("/") ? rawApiBase.slice(0, -1) : rawApiBase;
const MEDIA_BASE = `${API_BASE}/media`;
const API_PAGE_SIZE = 50;

const SERVICE_LABELS = {
  patreon: "Patreon",
  fanbox: "Pixiv Fanbox",
  fantia: "Fantia",
  discord: "Discord",
  gumroad: "Gumroad",
  dlsite: "DLsite",
};

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
  return (
    <span className="timestamp">
      <span className="timestamp-date">{prefix ? `${prefix} ${date}` : date}</span>
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

function App() {
  const [view, setView] = useState({ name: "home" });
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

  const openCreator = (service, creatorId, creatorName) => {
    setView({ name: "creator", service, creatorId, creatorName });
  };

  const openPost = (service, creatorId, creatorName, postId) => {
    setView({ name: "post", service, creatorId, creatorName, postId });
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
              <button className="brand-link" type="button" onClick={() => setView({ name: "home" })}>
                Kemono Explorer
              </button>
            </h1>
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
              onOpenPost={(postId) => openPost(view.service, view.creatorId, view.creatorName, postId)}
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
              onBack={() =>
                setView({
                  name: "creator",
                  service: view.service,
                  creatorId: view.creatorId,
                  creatorName: view.creatorName,
                })
              }
              onNavigate={(nextPostId) =>
                setView({
                  name: "post",
                  service: view.service,
                  creatorId: view.creatorId,
                  creatorName: view.creatorName,
                  postId: nextPostId,
                })
              }
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
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);
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
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchDisplayCount, setSearchDisplayCount] = useState(0);
  const [searchNextOffset, setSearchNextOffset] = useState(0);
  const [searchExhausted, setSearchExhausted] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const filterStorageKey = `kemono.filterFields.${service}.${creatorId}`;
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
    setLoadingProfile(true);
    fetchJson(`${API_BASE}/${service}/user/${creatorId}/profile`).then((data) => {
      if (!alive) return;
      setProfile(data);
      setLoadingProfile(false);
    });
    return () => {
      alive = false;
    };
  }, [service, creatorId]);

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
    runSearch({ query: trimmed, append: false, pageSize: limit });
  }, [filterFields.title, filterFields.tags, filterFields.body, limit, activeFilter]);

  useEffect(() => {
    const trimmedFilter = typeof activeFilter === "string" ? activeFilter.trim() : "";
    setSearchInput(trimmedFilter);
    searchTokenRef.current += 1;
    if (!trimmedFilter) {
      setSearchResults([]);
      setSearchDisplayCount(0);
      setSearchNextOffset(0);
      setSearchExhausted(false);
      setSearchLoading(false);
      return;
    }
    setOffset((value) => (value !== 0 ? 0 : value));
    setSearchResults([]);
    setSearchDisplayCount(0);
    setSearchNextOffset(0);
    setSearchExhausted(false);
    runSearch({ query: trimmedFilter, append: false, pageSize: limit });
  }, [service, creatorId, activeFilter, limit, reloadKey]);

  const extractTagTokens = (value) =>
    String(value || "")
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);

  const runSearch = async ({ query, append = false, pageSize } = {}) => {
    const trimmed = (query || "").trim();
    const tagTokens = filterFields.tags ? extractTagTokens(trimmed) : [];
    const textQueryEnabled = filterFields.title || filterFields.body;
    const applyTextQuery = textQueryEnabled && (!filterFields.tags || tagTokens.length === 0);
    const textQuery = applyTextQuery ? trimmed : "";
    const hasQuery = textQuery.length > 0;
    const hasTags = filterFields.tags && tagTokens.length > 0;
    if (!hasQuery && !hasTags) return;

    const desiredPageSize = pageSize ?? limit;
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
    let workingResults = append ? [...searchResults] : [];
    let offset = append ? searchNextOffset : 0;
    let exhausted = append ? searchExhausted : false;
    const targetCount = append ? searchDisplayCount + desiredPageSize : desiredPageSize;

    if (!append) {
      setSearchResults([]);
      setSearchDisplayCount(0);
      setSearchNextOffset(0);
      setSearchExhausted(false);
    }

    setSearchLoading(true);

    try {
      while (workingResults.length < targetCount && !exhausted) {
        const chunk = await fetchJson(
          `${API_BASE}/${service}/user/${creatorId}/posts?o=${offset}&n=${API_PAGE_SIZE}${hasQuery ? `&q=${encodedQuery}` : ""}${fieldParams}${tagParams}`,
        );
        if (token !== searchTokenRef.current) return;
        if (!Array.isArray(chunk) || chunk.length === 0) {
          exhausted = true;
          break;
        }
        workingResults = workingResults.concat(chunk);
        offset += API_PAGE_SIZE;
        if (chunk.length < API_PAGE_SIZE) {
          exhausted = true;
        }
      }

      if (token !== searchTokenRef.current) return;

      const nextDisplayCount = Math.min(targetCount, workingResults.length);

      setSearchResults(workingResults);
      setSearchDisplayCount(nextDisplayCount);
      setSearchNextOffset(offset);
      setSearchExhausted(exhausted);
    } catch (error) {
      console.error("Post search failed", error);
      if (token !== searchTokenRef.current) return;
      setSearchExhausted(true);
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
      runSearch({ query: trimmed, append: false, pageSize: limit });
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
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(filterStorageKey);
    }
    setFilterFields(getDefaultFilterFields());
  };

  const handleSearchLoadMore = () => {
    const currentFilter = typeof activeFilter === "string" ? activeFilter.trim() : "";
    const hasTags = filterFields.tags ? extractTagTokens(currentFilter).length > 0 : false;
    if (!currentFilter && !hasTags) return;
    if (searchLoading) return;
    const targetCount = searchDisplayCount + limit;
    if (searchResults.length >= targetCount) {
      setSearchDisplayCount(Math.min(targetCount, searchResults.length));
      return;
    }
    runSearch({ query: currentFilter, append: true });
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
    setLoadingPosts(true);
    setHasNextPage(false);

    const start = offset;
    const requested = limit > 0 ? limit : API_PAGE_SIZE;
    const firstChunkOffset = Math.floor(start / API_PAGE_SIZE) * API_PAGE_SIZE;
    const lastIndexNeeded = Math.max(start, start + requested - 1);
    const lastChunkOffset = Math.floor(lastIndexNeeded / API_PAGE_SIZE) * API_PAGE_SIZE;

    const chunkOffsets = [];
    for (let current = firstChunkOffset; current <= lastChunkOffset; current += API_PAGE_SIZE) {
      chunkOffsets.push(current);
    }
    if (chunkOffsets.length === 0) chunkOffsets.push(0);

    Promise.all(
      chunkOffsets.map((chunkOffset) =>
        fetchJson(`${API_BASE}/${service}/user/${creatorId}/posts?o=${chunkOffset}&n=${API_PAGE_SIZE}`),
      ),
    )
      .then((responses) => {
        if (!alive) return;

        const combined = responses.reduce((acc, data) => {
          if (Array.isArray(data) && data.length) {
            acc.push(...data);
          }
      return acc;
    }, []);

    const sliceStart = start - chunkOffsets[0];
    const slice = combined.slice(sliceStart, sliceStart + requested);
    setPosts(slice);

    const lastResponse = responses[responses.length - 1];
    const lastChunkLength = Array.isArray(lastResponse) ? lastResponse.length : 0;
    const availableFromStart = Math.max(0, combined.length - sliceStart);
    const hasMore = availableFromStart > slice.length || lastChunkLength === API_PAGE_SIZE;
    setHasNextPage(hasMore);
    setLoadingPosts(false);
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
  }, [service, creatorId, offset, limit, reloadKey, activeFilter]);

  const hasPrev = offset > 0;
  const totalPosts =
    typeof profile?.post_count === "number"
      ? profile.post_count
      : Number.isFinite(Number(profile?.post_count))
        ? Number(profile?.post_count)
        : null;
  const derivedTotalPages = totalPosts && limit > 0 ? Math.max(1, Math.ceil(totalPosts / limit)) : null;
  const currentPage = limit > 0 ? Math.floor(offset / limit) + 1 : 1;
  const hasNext = derivedTotalPages ? offset + limit < totalPosts : hasNextPage;
  const totalPages = derivedTotalPages ?? currentPage + (hasNext ? 1 : 0);
  const avatarUrl = `https://img.kemono.cr/icons/${service}/${creatorId}`;
  const serviceLabel = getServiceLabel(service);
  const normalizedFilter = typeof activeFilter === "string" ? activeFilter.trim() : "";
  const activeTags = filterFields.tags ? extractTagTokens(normalizedFilter) : [];
  const isFilterActive = normalizedFilter.length > 0;
  const displayedPosts = isFilterActive ? searchResults.slice(0, Math.max(0, searchDisplayCount)) : posts;
  const listLoading = isFilterActive ? searchLoading && displayedPosts.length === 0 : loadingPosts;
  const summaryLabel = isFilterActive
    ? listLoading
      ? `Filtering ${activeTags.length > 0 ? `${activeTags.length} tag${activeTags.length === 1 ? "" : "s"}` : `"${normalizedFilter}"`}...`
      : displayedPosts.length === 0
        ? `No posts match ${activeTags.length > 0 ? `${activeTags.length} tag${activeTags.length === 1 ? "" : "s"}` : `"${normalizedFilter}"`} yet`
        : searchExhausted
          ? `${displayedPosts.length} posts match ${activeTags.length > 0 ? `${activeTags.length} tag${activeTags.length === 1 ? "" : "s"}` : `"${normalizedFilter}"`}`
          : `${displayedPosts.length} posts match ${activeTags.length > 0 ? `${activeTags.length} tag${activeTags.length === 1 ? "" : "s"}` : `"${normalizedFilter}"`} (more available)`
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

  const renderPagination = () => {
    if (isFilterActive) return null;
    if (totalPages <= 1) return null;

    const pages = [];

    const maxDirectDisplay = compactPagination ? 5 : 9;
    const windowRadius = compactPagination ? 1 : 2;

    if (totalPages <= maxDirectDisplay) {
      for (let p = 1; p <= totalPages; p += 1) pages.push(p);
    } else {
      pages.push(1);

      let start = currentPage - windowRadius;
      let end = currentPage + windowRadius;

      if (start < 2) {
        end += 2 - start;
        start = 2;
      }

      if (end > totalPages - 1) {
        start -= end - (totalPages - 1);
        end = totalPages - 1;
      }

      start = Math.max(2, start);
      end = Math.min(totalPages - 1, end);

      if (start > 2) pages.push("ellipsis-start");

      for (let p = start; p <= end; p += 1) pages.push(p);

      if (end < totalPages - 1) pages.push("ellipsis-end");

      pages.push(totalPages);
    }

    return (
      <div className="pagination-block">
        <div className="pagination-meta">
          <span className="label">
            Page <strong>{currentPage}</strong> of {totalPages}
          </span>
        </div>
        <nav className="pagination">
          {!compactPagination && (
            <button className="btn ghost" type="button" disabled={!hasPrev} onClick={() => goToPage(currentPage - 1)}>
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
              const isActive = item === currentPage;
              return (
                <button
                  key={item}
                  className={`page-pill${isActive ? " active" : ""}`}
                  type="button"
                  onClick={() => goToPage(item)}
                  disabled={isActive}
                >
                  {item}
                </button>
              );
            })}
          </div>
          {!compactPagination && (
            <button className="btn ghost" type="button" disabled={!hasNext} onClick={() => goToPage(currentPage + 1)}>
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
                <span className="muted small">
                  {loadingProfile ? "Loading profile..." : `${profile?.post_count ?? "-"} posts indexed`}
                </span>
              </div>
            </div>
          </div>
          <div className="card-actions">
            <button
              className="btn"
              onClick={() => {
                setReloadKey((value) => value + 1);
              }}
            >
              Refresh posts
            </button>
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

      <section className="card">
        <div className="card-row header-row">
          <div className="card-col">
            <h3 className="title">Recent posts</h3>
            <span className="label">{summaryLabel}</span>
          </div>
          <div className="controls">
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
            <label className="label" htmlFor="page-size">
              Page size
            </label>
            <select
              id="page-size"
              className="input small"
              value={limit}
              onChange={(event) => {
                const nextLimit = parseInt(event.target.value, 10);
                setOffset(0);
                setLimit(nextLimit);
              }}
            >
              {[25, 50, 75, 100].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </div>
        </div>
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
        {renderPagination()}
        <div className="post-list">
          {displayedPosts.map((post) => {
            const excerptHtml = showExcerpts ? getPostExcerptHtml(post) : null;
            const hasTags = Array.isArray(post.tags) && post.tags.length > 0;
            return (
              <button className="post-item" key={post.id} type="button" onClick={() => onOpenPost(post.id)}>
                <div className="post-body">
                  <div className="post-head">
                    <span className="post-title">{post.title || post.id}</span>
                    <Timestamp value={post.published} />
                  </div>
                  {showTags && hasTags && (
                    <div className="tag-row">
                      {post.tags.map((tag) => (
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
        {isFilterActive && displayedPosts.length > 0 && (
          <div className="search-footer">
            {!searchExhausted ? (
              <button className="btn ghost" type="button" onClick={handleSearchLoadMore} disabled={searchLoading}>
                {searchLoading ? "Filtering..." : "Load more results"}
              </button>
            ) : (
              <span className="muted small">End of filtered results.</span>
            )}
          </div>
        )}
        {renderPagination()}
      </section>
    </div>
  );
}

function PostView({ service, creatorId, creatorName, postId, activeFilter, onBack, onNavigate }) {
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [neighbors, setNeighbors] = useState({ newerId: null, olderId: null });
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
  const buildFieldQueryParams = () => {
    const fields = getStoredFilterFields();
    return `&title=${fields.title ? "true" : "false"}&tags=${fields.tags ? "true" : "false"}&body=${fields.body ? "true" : "false"}`;
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchJson(`${API_BASE}/${service}/user/${creatorId}/post/${postId}`).then((data) => {
      if (!alive) return;
      setPost(data?.post || null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [service, creatorId, postId]);

  useEffect(() => {
    let alive = true;
    setNeighbors({ newerId: null, olderId: null });

    const trimmedFilter = typeof activeFilter === "string" ? activeFilter.trim() : "";
    const queryParam = trimmedFilter ? `&q=${encodeURIComponent(trimmedFilter)}` : "";
    const fieldParams = trimmedFilter ? buildFieldQueryParams() : "";

    const resolveNeighbors = async () => {
      let offset = 0;
      let prevChunkLast = null;

      try {
        while (alive) {
          const chunk = await fetchJson(
            `${API_BASE}/${service}/user/${creatorId}/posts?o=${offset}&n=${API_PAGE_SIZE}${queryParam}${fieldParams}`,
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
                `${API_BASE}/${service}/user/${creatorId}/posts?o=${offset + API_PAGE_SIZE}&n=${API_PAGE_SIZE}${queryParam}${fieldParams}`,
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

  return (
    <div className="page">
      <article className="card post-card">
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
        <header className="post-header">
          <h2 className="title">{post.title || post.id}</h2>
          <Timestamp value={post.published} prefix="Published" />
          <span className="muted small">{creatorName || creatorId}</span>
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

