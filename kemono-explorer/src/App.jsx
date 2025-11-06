import React, { useEffect, useState } from "react";
import "./App.css";

const rawApiBase = import.meta.env.VITE_API_BASE || "/api/proxy/kemono";
const API_BASE = rawApiBase.endsWith("/") ? rawApiBase.slice(0, -1) : rawApiBase;
const MEDIA_BASE = `${API_BASE}/media`;
const API_PAGE_SIZE = 50;

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

function formatDate(ts) {
  if (!ts) return { date: "—", time: "" };
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
              onRemoveCreator={(service, id) =>
                setSavedCreators((prev) => prev.filter((c) => !(c.service === service && c.id === id)))
              }
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
            />
          )}

          {view.name === "post" && (
            <PostView
              service={view.service}
              creatorId={view.creatorId}
              creatorName={view.creatorName}
              postId={view.postId}
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

function Home({ savedCreators, onSaveCreator, onRemoveCreator, onOpenCreator }) {
  const [service, setService] = useState("patreon");
  const [creatorId, setCreatorId] = useState("");
  const [creatorName, setCreatorName] = useState("");

  const handleSave = (event) => {
    event.preventDefault();
    const id = creatorId.trim();
    if (!id) return;
    onSaveCreator({ service, id, name: creatorName.trim() });
    setCreatorId("");
    setCreatorName("");
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
              <div className="list-details">
                <button className="link list-title" onClick={() => onOpenCreator(c.service, c.id, c.name)}>
                  {c.name || c.id}
                </button>
                <span className="muted small">
                  {c.service} - {c.id}
                </span>
              </div>
              <button className="btn subtle" onClick={() => onRemoveCreator(c.service, c.id)}>
                Remove
              </button>
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

function CreatorPage({ service, creatorId, creatorName, alreadySaved, onOpenPost, onSave }) {
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);

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
  }, [service, creatorId, offset, limit, reloadKey]);

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

  function goToPage(page) {
    if (!limit) return;
    setOffset(Math.max(0, (page - 1) * limit));
  }

  const renderPagination = () => {
    if (totalPages <= 1) return null;

    const pages = [];

    if (totalPages <= 9) {
      for (let p = 1; p <= totalPages; p += 1) pages.push(p);
    } else {
      pages.push(1);

      let start = currentPage - 2;
      let end = currentPage + 2;

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
          <button className="btn ghost" type="button" disabled={!hasPrev} onClick={() => goToPage(currentPage - 1)}>
            &larr; Prev
          </button>
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
          <button className="btn ghost" type="button" disabled={!hasNext} onClick={() => goToPage(currentPage + 1)}>
            Next &rarr;
          </button>
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
              <span className="muted small">
                {loadingProfile ? "Loading profile..." : `${profile?.post_count ?? "-"} posts indexed`}
              </span>
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
            <span className="label">
              {loadingPosts ? "Loading..." : `Showing ${posts.length} items`}
            </span>
          </div>
          <div className="controls">
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
        {renderPagination()}
        <div className="post-list">
          {posts.map((post) => (
            <button className="post-item" key={post.id} type="button" onClick={() => onOpenPost(post.id)}>
              <div className="post-body">
                <div className="post-head">
                  <span className="post-title">{post.title || post.id}</span>
                  <Timestamp value={post.published} />
                </div>
                {Array.isArray(post.tags) && post.tags.length > 0 && (
                  <div className="tag-row">
                    {post.tags.map((tag) => (
                      <span className="tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {post.substring && <p className="excerpt" dangerouslySetInnerHTML={{ __html: post.substring }} />}
              </div>
            </button>
          ))}
          {!loadingPosts && posts.length === 0 && (
            <div className="muted empty-state">No posts found for this page.</div>
          )}
        </div>
        {renderPagination()}
      </section>
    </div>
  );
}

function PostView({ service, creatorId, creatorName, postId, onBack, onNavigate }) {
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [neighbors, setNeighbors] = useState({ newerId: null, olderId: null });

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

    fetchJson(`${API_BASE}/${service}/user/${creatorId}/posts?o=0&n=200`).then((data) => {
      if (!alive) return;
      if (!Array.isArray(data)) {
        setNeighbors({ newerId: null, olderId: null });
        return;
      }
      const index = data.findIndex((item) => `${item.id}` === `${postId}`);
      if (index === -1) {
        setNeighbors({ newerId: null, olderId: null });
        return;
      }
      const newer = index > 0 ? data[index - 1] : null;
      const older = index < data.length - 1 ? data[index + 1] : null;
      setNeighbors({
        newerId: newer?.id || null,
        olderId: older?.id || null,
      });
    });

    return () => {
      alive = false;
    };
  }, [service, creatorId, postId]);

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
