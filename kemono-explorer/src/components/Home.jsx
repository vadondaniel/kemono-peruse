import React, { useState } from "react";

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
        <form className="form" onSubmit={handleOpen}>
          <div className="form-row">
            <label className="label" htmlFor="creator-service">
              Service
            </label>
            <select
              id="creator-service"
              className="input"
              value={service}
              onChange={(event) => setService(event.target.value)}
            >
              <option value="patreon">Patreon</option>
              <option value="fanbox">Pixiv Fanbox</option>
              <option value="fantia">Fantia</option>
              <option value="discord">Discord</option>
              <option value="gumroad">Gumroad</option>
              <option value="dlsite">DLsite</option>
            </select>
          </div>
          <div className="form-row">
            <label className="label" htmlFor="creator-id">
              Creator ID
            </label>
            <input
              id="creator-id"
              className="input"
              value={creatorId}
              onChange={(event) => setCreatorId(event.target.value)}
              placeholder="e.g. 1234567"
            />
          </div>
          <div className="form-row">
            <label className="label" htmlFor="creator-name">
              Display name (optional)
            </label>
            <input
              id="creator-name"
              className="input"
              value={creatorName}
              onChange={(event) => setCreatorName(event.target.value)}
              placeholder="Used locally for display"
            />
          </div>
          <div className="form-actions">
            <button className="btn primary" type="submit">
              View creator
            </button>
            <button className="btn ghost" type="button" onClick={handleSave}>
              Save creator
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default Home;
