import React, { useCallback, useEffect, useRef, useState } from "react";

import "./App.css";

import CreatorPage from "./components/CreatorPage.jsx";
import Home from "./components/Home.jsx";
import PostView from "./components/PostView.jsx";
import { buildHistoryState, ensureView, getInitialView, getTitleForView, getUrlForView, getViewFromHistoryState, viewsEqual } from "./utils/navigation.js";

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
      const next = getViewFromHistoryState(event.state, window.location.pathname, window.location.search);
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

  const [creatorPositions, setCreatorPositions] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("kemono.creatorPositions") || "{}");
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("kemono.creatorPositions", JSON.stringify(creatorPositions));
    } catch {
      // ignore persistence failures
    }
  }, [creatorPositions]);

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
  const handleLinkNavigation = useCallback(
    (event, nextView) => {
      if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
        return;
      }
      event.preventDefault();
      navigate(nextView);
    },
    [navigate],
  );

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

  const openCreator = (service, creatorId, creatorName, positionOverride) => {
    const effectivePosition =
      typeof positionOverride === "number"
        ? positionOverride
        : getCreatorPosition(service, creatorId);
    navigate({
      name: "creator",
      service,
      creatorId,
      creatorName,
      position: effectivePosition > 0 ? effectivePosition : undefined,
    });
  };

  const openPost = (service, creatorId, creatorName, postId, postTitle, positionOverride) => {
    const effectivePosition =
      typeof positionOverride === "number"
        ? positionOverride
        : getCreatorPosition(service, creatorId);
    navigate({
      name: "post",
      service,
      creatorId,
      creatorName,
      postId,
      postTitle,
      position: effectivePosition > 0 ? effectivePosition : undefined,
    });
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

  const getCreatorPosition = (service, creatorId) => {
    if (!service || !creatorId) return 0;
    const key = `${service}:${creatorId}`;
    const value = creatorPositions[key];
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };

  const updateCreatorPosition = (service, creatorId, position) => {
    if (!service || !creatorId) return;
    const key = `${service}:${creatorId}`;
    setCreatorPositions((prev) => {
      const nextValue = Number.isFinite(position) && position >= 0 ? Math.floor(position) : 0;
      if (prev[key] === nextValue) return prev;
      return { ...prev, [key]: nextValue };
    });
  };

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="header-top">
            <h1 className="title">
              <a
                className="brand-link"
                href={getUrlForView({ name: "home" })}
                onClick={(event) => handleLinkNavigation(event, { name: "home" })}
              >
                Kemono Explorer
              </a>
            </h1>
            {view.name === "post" && (
              <button
                type="button"
                className={`btn ghost reader-settings-button header-reader-button${readerSettingsOpen ? " active" : ""}`}
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
          {/* <p className="muted">
            Browse kemono.cr with a tidy reader. Save creators you follow, scan their latest posts, and dive into content without leaving the page.
          </p> */}
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
              onOpenPost={(postId, postTitle, position) =>
                openPost(view.service, view.creatorId, view.creatorName, postId, postTitle, position)
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
              initialPosition={
                typeof view.position === "number"
                  ? view.position
                  : getCreatorPosition(view.service, view.creatorId)
              }
              onRememberPosition={(position) => updateCreatorPosition(view.service, view.creatorId, position)}
            />
          )}

          {view.name === "post" && (() => {
            const rawFilter = getCreatorFilter(view.service, view.creatorId);
            const trimmedFilter = rawFilter.trim();
            const hasFilter = trimmedFilter.length > 0;
            const currentPosition = hasFilter
              ? undefined
              : typeof view.position === "number"
                ? view.position
                : getCreatorPosition(view.service, view.creatorId);
            return (
              <PostView
                service={view.service}
                creatorId={view.creatorId}
                creatorName={view.creatorName}
                postId={view.postId}
                creatorPosition={currentPosition}
                activeFilter={rawFilter}
                readerSettingsOpen={readerSettingsOpen}
                onCloseReaderSettings={() => setReaderSettingsOpen(false)}
                onBack={() => {
                  navigate({
                    name: "creator",
                    service: view.service,
                    creatorId: view.creatorId,
                    creatorName: view.creatorName,
                    position: currentPosition > 0 ? currentPosition : undefined,
                  });
                }}
                onNavigate={(nextPostId) => {
                  navigate({
                    name: "post",
                    service: view.service,
                    creatorId: view.creatorId,
                    creatorName: view.creatorName,
                    postId: nextPostId,
                    position: currentPosition > 0 ? currentPosition : undefined,
                  });
                }}
                onResolvePostTitle={handleResolvePostTitle}
                onResolveCreatorPosition={(position) =>
                  updateCreatorPosition(view.service, view.creatorId, position)
                }
              />
            );
          })()}
        </main>
      </div>
    </div>
  );
}

export default App;
