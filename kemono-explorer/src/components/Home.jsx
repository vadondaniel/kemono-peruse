import React, { useEffect, useMemo, useRef, useState } from "react";

import { API_BASE, SERVICE_LABELS } from "../constants.js";
import { getUrlForView } from "../utils/navigation.js";
import { fetchJson } from "../utils/api.js";

const isModifiedClick = (event) =>
  event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;

const SERVICE_ORDER = ["patreon", "fanbox", "fantia", "discord", "gumroad", "dlsite"];

const formatServiceLabel = (value) => {
  if (!value) return "";
  if (SERVICE_LABELS[value]) return SERVICE_LABELS[value];
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const SERVICE_OPTIONS = SERVICE_ORDER.map((value) => ({
  value,
  label: formatServiceLabel(value),
}));

const SERVICE_FILTER_OPTIONS = [{ value: "all", label: "All services" }, ...SERVICE_OPTIONS];

const normalizeTimestamp = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric > 1_000_000_000_000 ? Math.floor(numeric) : Math.floor(numeric * 1000);
};

const CREATOR_SEARCH_LIMIT = 30;
const CREATOR_TOOL_TABS = [
  { value: "search", label: "Creator search" },
  { value: "quick-add", label: "Quick add" },
];

function Home({ savedCreators, onSaveCreator, onRenameCreator, onRemoveCreator, onOpenCreator }) {
  const [service, setService] = useState("patreon");
  const [creatorId, setCreatorId] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [savedFilter, setSavedFilter] = useState("");
  const [editingCreator, setEditingCreator] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [creatorSearchQuery, setCreatorSearchQuery] = useState("");
  const [creatorSearchService, setCreatorSearchService] = useState("all");
  const [creatorDirectory, setCreatorDirectory] = useState(null);
  const [creatorDirectoryStatus, setCreatorDirectoryStatus] = useState("idle");
  const [creatorDirectoryError, setCreatorDirectoryError] = useState("");
  const [activeCreatorTool, setActiveCreatorTool] = useState("search");
  const formRef = useRef(null);
  const savedListRef = useRef(null);
  const creatorIdRef = useRef(null);
  const creatorDirectoryTokenRef = useRef(0);
  const normalizedSearchQuery = creatorSearchQuery.trim().toLowerCase();
  const searchTokens = useMemo(
    () => normalizedSearchQuery.split(/\s+/).filter(Boolean),
    [normalizedSearchQuery],
  );
  const searchReady = normalizedSearchQuery.length >= 2;

  useEffect(() => {
    if (!searchReady) return;
    if (creatorDirectory || creatorDirectoryStatus === "loading" || creatorDirectoryStatus === "ready") {
      return;
    }
    const token = creatorDirectoryTokenRef.current + 1;
    creatorDirectoryTokenRef.current = token;
    setCreatorDirectoryStatus("loading");
    setCreatorDirectoryError("");
    fetchJson(`${API_BASE}/creators`)
      .then((data) => {
        if (token !== creatorDirectoryTokenRef.current) return;
        if (!Array.isArray(data)) {
          throw new Error("Creator directory not available");
        }
        const normalized = data
          .map((entry) => {
            if (!entry) return null;
            const rawId =
              typeof entry.id === "string" ? entry.id.trim() : String(entry.id ?? "").trim();
            const service =
              typeof entry.service === "string" ? entry.service.trim().toLowerCase() : "";
            if (!rawId || !service) return null;
            const name = typeof entry.name === "string" ? entry.name.trim() : "";
            const favoritedNumber = Number(entry.favorited);
            return {
              id: rawId,
              idLower: rawId.toLowerCase(),
              service,
              name,
              nameLower: name.toLowerCase(),
              favorited: Number.isFinite(favoritedNumber) ? favoritedNumber : 0,
              indexed: normalizeTimestamp(entry.indexed),
              updated: normalizeTimestamp(entry.updated),
            };
          })
          .filter(Boolean);
        setCreatorDirectory(normalized);
        setCreatorDirectoryStatus("ready");
      })
      .catch((error) => {
        console.error("Failed to load creator directory", error);
        if (token !== creatorDirectoryTokenRef.current) return;
        setCreatorDirectoryStatus("error");
        setCreatorDirectoryError(
          error?.message || "Unable to load creator directory. Please try again.",
        );
      });
  }, [searchReady, creatorDirectory, creatorDirectoryStatus]);

  useEffect(
    () => () => {
      creatorDirectoryTokenRef.current += 1;
    },
    [],
  );

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

  const buildCreatorHref = (targetService, targetId, targetName) => {
    const trimmedId = (targetId || "").trim();
    if (!trimmedId) return "#";
    const cleanedName = (targetName || "").trim();
    return getUrlForView({
      name: "creator",
      service: targetService,
      creatorId: trimmedId,
      creatorName: cleanedName || trimmedId,
    });
  };

  const openCreatorInline = (targetService, targetId, targetName) => {
    const trimmedId = (targetId || "").trim();
    if (!trimmedId) return false;
    onOpenCreator(targetService, trimmedId, (targetName || "").trim());
    return true;
  };

  const handleOpen = (event) => {
    event.preventDefault();
    const success = openCreatorInline(service, creatorId, creatorName);
    if (!success) {
      focusCreatorInput();
    }
  };

  const handleSearchClear = () => setCreatorSearchQuery("");
  const handleSearchSave = (entry) => {
    if (!entry) return;
    onSaveCreator({ service: entry.service, id: entry.id, name: entry.name });
  };

  const handleCreatorLink = (event, targetService, targetId, targetName, fallbackFocus = null) => {
    const trimmedId = (targetId || "").trim();
    if (!trimmedId) {
      event.preventDefault();
      if (typeof fallbackFocus === "function") fallbackFocus();
      return;
    }
    if (isModifiedClick(event)) {
      return;
    }
    event.preventDefault();
    openCreatorInline(targetService, trimmedId, targetName);
  };

  const focusCreatorInput = () => creatorIdRef.current?.focus();
  const scrollToTools = () => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const scrollToSaved = () => savedListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const resetCreatorDirectory = () => {
    creatorDirectoryTokenRef.current += 1;
    setCreatorDirectory(null);
    setCreatorDirectoryStatus("idle");
    setCreatorDirectoryError("");
  };
  const handleShowQuickAdd = () => {
    setActiveCreatorTool("quick-add");
    scrollToTools();
    setTimeout(() => focusCreatorInput(), 0);
  };

  const filteredCreators = useMemo(() => {
    const trimmed = savedFilter.trim().toLowerCase();
    if (!trimmed) return savedCreators;
    return savedCreators.filter((entry) => {
      const name = (entry.name || "").toLowerCase();
      const id = (entry.id || "").toLowerCase();
      const serviceLabel = formatServiceLabel(entry.service).toLowerCase();
      return name.includes(trimmed) || id.includes(trimmed) || serviceLabel.includes(trimmed);
    });
  }, [savedCreators, savedFilter]);

  const savedCreatorKeys = useMemo(() => {
    const next = new Set();
    savedCreators.forEach((entry) => {
      if (entry?.service && entry?.id) {
        next.add(`${entry.service}:${entry.id}`);
      }
    });
    return next;
  }, [savedCreators]);

  const { creatorSearchResults, totalCreatorMatches } = useMemo(() => {
    if (!creatorDirectory || !searchReady || searchTokens.length === 0) {
      return { creatorSearchResults: [], totalCreatorMatches: 0 };
    }
    const matches = [];
    for (const entry of creatorDirectory) {
      if (!entry) continue;
      if (creatorSearchService !== "all" && entry.service !== creatorSearchService) {
        continue;
      }
      const match = searchTokens.every((token) => {
        if (!token) return true;
        return entry.nameLower.includes(token) || entry.idLower.includes(token);
      });
      if (match) {
        matches.push(entry);
      }
    }
    matches.sort((a, b) => {
      if (b.favorited !== a.favorited) return b.favorited - a.favorited;
      if (b.updated !== a.updated) return b.updated - a.updated;
      if (b.indexed !== a.indexed) return b.indexed - a.indexed;
      return (a.name || a.id).localeCompare(b.name || b.id);
    });
    return {
      creatorSearchResults: matches.slice(0, CREATOR_SEARCH_LIMIT),
      totalCreatorMatches: matches.length,
    };
  }, [creatorDirectory, creatorSearchService, searchReady, searchTokens]);

  const uniqueServiceCount = useMemo(() => {
    const services = new Set(savedCreators.map((entry) => entry.service));
    return services.size;
  }, [savedCreators]);

  const lastSaved = savedCreators.length > 0 ? savedCreators[savedCreators.length - 1] : null;
  const hasSavedCreators = savedCreators.length > 0;
  const hasFilter = savedFilter.trim().length > 0;
  const emptySearch = hasFilter && filteredCreators.length === 0;
  const activeServiceLabel = formatServiceLabel(service);
  const searchLoading = creatorDirectoryStatus === "loading";
  const searchErrored = creatorDirectoryStatus === "error";
  const searchHasQuery = creatorSearchQuery.trim().length > 0;
  const searchNeedsMoreInput = searchHasQuery && !searchReady;
  const searchEmpty =
    searchReady && !searchLoading && !searchErrored && creatorSearchResults.length === 0;
  const showSearchLimitNotice = totalCreatorMatches > CREATOR_SEARCH_LIMIT;
  const trimmedSearchQuery = creatorSearchQuery.trim();
  const searchSummaryLabelService =
    creatorSearchService !== "all" ? formatServiceLabel(creatorSearchService) : null;
  let searchStatusContent = null;
  if (!searchHasQuery) {
    searchStatusContent = "Search the Kemono directory.";
  } else if (searchNeedsMoreInput) {
    searchStatusContent = "Enter at least 2 characters.";
  } else if (searchLoading) {
    searchStatusContent = "Loading creator directory…";
  } else if (searchErrored) {
    searchStatusContent = (
      <>
        {creatorDirectoryError || "Unable to load creators."}
        <button className="btn subtle inline-retry" type="button" onClick={resetCreatorDirectory}>
          Retry
        </button>
      </>
    );
  } else if (searchEmpty) {
    searchStatusContent = `No matches for "${trimmedSearchQuery}".`;
  } else if (creatorSearchResults.length > 0) {
    const rangeNote = showSearchLimitNotice
      ? `Showing ${creatorSearchResults.length} of ${totalCreatorMatches}`
      : `Showing ${creatorSearchResults.length}`;
    const queryNote = trimmedSearchQuery ? ` for "${trimmedSearchQuery}"` : "";
    const serviceNote = searchSummaryLabelService ? ` · ${searchSummaryLabelService}` : "";
    searchStatusContent = `${rangeNote}${queryNote}${serviceNote}`;
  }

  return (
    <div className="home-layout">
      <section className="card home-hero">
        <div className="hero-content">
          <div className="hero-copy">
            <span className="hero-badge">Dashboard</span>
            <h2 className="title">Everything you follow, one tap away.</h2>
            <p className="muted">
              Pin your favorite creators, jump into cached feeds, and stay organized while browsing Kemono.
            </p>
          </div>
          <div className="hero-actions">
            <button className="btn primary" type="button" onClick={handleShowQuickAdd}>
              Add a creator
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={scrollToSaved}
              disabled={!hasSavedCreators}
            >
              View library
            </button>
          </div>
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <span className="hero-stat-label">Saved creators</span>
            <strong>{savedCreators.length}</strong>
            <span className="hero-stat-sub">
              {hasSavedCreators ? "Ready to open instantly" : "Add your first favorite"}
            </span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-label">Services covered</span>
            <strong>{uniqueServiceCount}</strong>
            <span className="hero-stat-sub">{uniqueServiceCount > 0 ? "Diverse feed" : "Pick a platform"}</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-label">Last added</span>
            <strong>{lastSaved ? lastSaved.name || lastSaved.id : "—"}</strong>
            <span className="hero-stat-sub">
              {lastSaved ? formatServiceLabel(lastSaved.service) : "Nothing pinned yet"}
            </span>
          </div>
        </div>
      </section>

      <div className="home-grid">
        <section className="card home-tools-card" ref={formRef}>
          <div className="card-row header-row">
            <div className="card-col">
              <h2 className="title">Creator tools</h2>
              <span className="label">
                {activeCreatorTool === "search"
                  ? "Look up creators directly from kemono.cr"
                  : "Jump straight to a creator or save them for later"}
              </span>
            </div>
            <div className="creator-tool-tabs" role="tablist" aria-label="Creator tools">
              {CREATOR_TOOL_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={activeCreatorTool === tab.value}
                  className={`creator-tool-tab${activeCreatorTool === tab.value ? " active" : ""}`}
                  onClick={() => setActiveCreatorTool(tab.value)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {activeCreatorTool === "search" ? (
            <div className="creator-tool-panel">
              <form className="search-form" onSubmit={(event) => event.preventDefault()}>
                <div className="creator-search-field-row">
                  <div className="search-field-wrapper">
                    <div className="search-field">
                      <input
                        id="creator-search-input"
                        aria-label="Search creators"
                        className="search-input"
                        value={creatorSearchQuery}
                        onChange={(event) => setCreatorSearchQuery(event.target.value)}
                        placeholder="Type a name or ID (min 2 characters)"
                      />
                      {creatorSearchQuery && (
                        <button className="search-clear" type="button" onClick={handleSearchClear}>
                          Clear
                        </button>
                      )}
                    </div>
                    {searchStatusContent && (
                      <div className="creator-search-status inline-status">{searchStatusContent}</div>
                    )}
                  </div>
                  <label
                    className="field creator-search-filter inline-filter"
                    htmlFor="creator-search-service"
                  >
                    <span className="label">Service</span>
                    <select
                      id="creator-search-service"
                      className="input"
                      value={creatorSearchService}
                      onChange={(event) => setCreatorSearchService(event.target.value)}
                    >
                      {SERVICE_FILTER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </form>

              {creatorSearchResults.length > 0 && (
                <div className="creator-search-results" role="list">
                  {creatorSearchResults.map((entry) => {
                    const key = `${entry.service}:${entry.id}`;
                    const serviceLabel = formatServiceLabel(entry.service);
                    const alreadySaved = savedCreatorKeys.has(key);
                    return (
                      <div className="creator-search-item" key={key} role="listitem">
                        <div className="creator-search-meta">
                          <a
                            className="creator-search-name"
                            href={buildCreatorHref(entry.service, entry.id, entry.name)}
                            onClick={(event) =>
                              handleCreatorLink(event, entry.service, entry.id, entry.name)
                            }
                          >
                            {entry.name || entry.id}
                          </a>
                          <span className="muted small">
                            {serviceLabel} · {entry.id}
                          </span>
                          {entry.favorited > 0 && (
                            <span className="creator-search-favorites">
                              {entry.favorited.toLocaleString()} favorites
                            </span>
                          )}
                        </div>
                        <div className="creator-search-actions">
                          <button
                            className="btn subtle"
                            type="button"
                            onClick={() => handleSearchSave(entry)}
                            disabled={alreadySaved}
                          >
                            {alreadySaved ? "Saved" : "Save"}
                          </button>
                          <a
                            className="btn outline btn-compact"
                            href={buildCreatorHref(entry.service, entry.id, entry.name)}
                            onClick={(event) =>
                              handleCreatorLink(event, entry.service, entry.id, entry.name)
                            }
                          >
                            Open
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

            </div>
          ) : (
            <div className="creator-tool-panel">
              <div className="service-pills" role="group" aria-label="Service">
                {SERVICE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`service-pill${service === option.value ? " active" : ""}`}
                    onClick={() => setService(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <form className="form-grid" onSubmit={handleOpen}>
                <label className="field" htmlFor="creator-id">
                  <span className="label">Creator ID</span>
                  <input
                    id="creator-id"
                    ref={creatorIdRef}
                    className="input"
                    value={creatorId}
                    onChange={(event) => setCreatorId(event.target.value)}
                    placeholder="e.g. 1234567"
                  />
                </label>
                <label className="field" htmlFor="creator-name">
                  <span className="label">Display name (optional)</span>
                  <input
                    id="creator-name"
                    className="input"
                    value={creatorName}
                    onChange={(event) => setCreatorName(event.target.value)}
                    placeholder="Used locally for display"
                  />
                </label>
              </form>

              <p className="home-hint">
                Currently set to <strong>{activeServiceLabel}</strong>. You can paste IDs directly from Kemono links.
              </p>

              <div className="form-actions">
                <a
                  className="btn primary"
                  href={buildCreatorHref(service, creatorId, creatorName)}
                  onClick={(event) => handleCreatorLink(event, service, creatorId, creatorName, focusCreatorInput)}
                >
                  View creator
                </a>
                <button className="btn ghost" type="button" onClick={handleSave}>
                  Save to list
                </button>
              </div>
            </div>
          )}
        </section>
        <section className="card home-saved-card" ref={savedListRef}>
          <div className="card-row header-row">
            <div className="card-col">
              <h2 className="title">Library</h2>
              <span className="label">
                {hasSavedCreators ? `${savedCreators.length} total saved` : "Nothing saved yet"}
              </span>
            </div>
            <div className="saved-controls">
              <input
                className="input saved-search"
                placeholder="Search saved creators"
                value={savedFilter}
                onChange={(event) => setSavedFilter(event.target.value)}
              />
              <button
                className="btn subtle"
                type="button"
                onClick={() => setSavedFilter("")}
                disabled={!savedFilter}
              >
                Clear
              </button>
            </div>
          </div>

          {hasSavedCreators ? (
            emptySearch ? (
              <div className="saved-empty">
                <p className="muted">No creators match your search.</p>
                <button className="btn subtle" type="button" onClick={() => setSavedFilter("")}>
                  Reset search
                </button>
              </div>
            ) : (
              <div className="saved-list" role="list">
                {filteredCreators.map((creator) => {
                  const key = `${creator.service}-${creator.id}`;
                  const label = formatServiceLabel(creator.service);
                  const isEditing =
                    editingCreator &&
                    editingCreator.service === creator.service &&
                    editingCreator.id === creator.id;

                  if (isEditing) {
                    return (
                      <div className="saved-item" key={key} role="listitem">
                        <form className="saved-edit" onSubmit={handleRenameSubmit}>
                          <input
                            className="input"
                            value={editingName}
                            onChange={(event) => setEditingName(event.target.value)}
                            placeholder="Display name"
                            autoFocus
                          />
                          <div className="saved-actions">
                            <button className="btn subtle" type="button" onClick={cancelRename}>
                              Cancel
                            </button>
                            <button className="btn primary" type="submit">
                              Save
                            </button>
                          </div>
                        </form>
                      </div>
                    );
                  }

                  return (
                    <div className="saved-item" key={key} role="listitem">
                      <div className="saved-meta">
                        <a
                          className="saved-name"
                          href={buildCreatorHref(creator.service, creator.id, creator.name)}
                          onClick={(event) =>
                            handleCreatorLink(event, creator.service, creator.id, creator.name)
                          }
                        >
                          {creator.name || creator.id}
                        </a>
                        <span className="muted small">
                          {label} · {creator.id}
                        </span>
                      </div>
                      <div className="saved-actions">
                        <button className="btn subtle" type="button" onClick={() => beginRename(creator)}>
                          Rename
                        </button>
                        <a
                          className="btn outline btn-compact"
                          href={buildCreatorHref(creator.service, creator.id, creator.name)}
                          onClick={(event) =>
                            handleCreatorLink(event, creator.service, creator.id, creator.name)
                          }
                        >
                          Open
                        </a>
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() => onRemoveCreator(creator.service, creator.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <div className="saved-empty">
              <p className="muted">Use the quick add form to build your personal reading list.</p>
              <ul className="home-tips">
                <li>Grab the service + creator ID directly from kemono.cr URLs.</li>
                <li>Give creators custom display names to keep things tidy.</li>
                <li>Use the library search to jump to anyone instantly.</li>
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default Home;
