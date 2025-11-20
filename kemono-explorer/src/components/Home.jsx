import React, { useMemo, useRef, useState } from "react";

import { SERVICE_LABELS } from "../constants.js";

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

function Home({ savedCreators, onSaveCreator, onRenameCreator, onRemoveCreator, onOpenCreator }) {
  const [service, setService] = useState("patreon");
  const [creatorId, setCreatorId] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [savedFilter, setSavedFilter] = useState("");
  const [editingCreator, setEditingCreator] = useState(null);
  const [editingName, setEditingName] = useState("");
  const formRef = useRef(null);
  const savedListRef = useRef(null);
  const creatorIdRef = useRef(null);

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

  const focusCreatorInput = () => creatorIdRef.current?.focus();
  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const scrollToSaved = () => savedListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

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

  const uniqueServiceCount = useMemo(() => {
    const services = new Set(savedCreators.map((entry) => entry.service));
    return services.size;
  }, [savedCreators]);

  const lastSaved = savedCreators.length > 0 ? savedCreators[savedCreators.length - 1] : null;
  const hasSavedCreators = savedCreators.length > 0;
  const hasFilter = savedFilter.trim().length > 0;
  const emptySearch = hasFilter && filteredCreators.length === 0;
  const activeServiceLabel = formatServiceLabel(service);

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
            <button className="btn primary" type="button" onClick={() => { focusCreatorInput(); scrollToForm(); }}>
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
        <section className="card home-form-card" ref={formRef}>
          <div className="card-row header-row">
            <div className="card-col">
              <h2 className="title">Quick add</h2>
              <span className="label">Jump straight to a creator or save them for later</span>
            </div>
          </div>

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
            <button className="btn primary" type="button" onClick={handleOpen}>
              View creator
            </button>
            <button className="btn ghost" type="button" onClick={handleSave}>
              Save to list
            </button>
          </div>
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
                        <button
                          className="saved-name"
                          type="button"
                          onClick={() => onOpenCreator(creator.service, creator.id, creator.name)}
                        >
                          {creator.name || creator.id}
                        </button>
                        <span className="muted small">
                          {label} · {creator.id}
                        </span>
                      </div>
                      <div className="saved-actions">
                        <button className="btn subtle" type="button" onClick={() => beginRename(creator)}>
                          Rename
                        </button>
                        <button
                          className="btn outline btn-compact"
                          type="button"
                          onClick={() => onOpenCreator(creator.service, creator.id, creator.name)}
                        >
                          Open
                        </button>
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
