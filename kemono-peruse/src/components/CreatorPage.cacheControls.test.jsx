import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { getCachePreferenceKey, writeCreatorCache } from "../utils/cache.js";

const fetchJsonMock = vi.fn();
const fetchJsonWithMetaMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
  fetchJsonWithMeta: (...args) => fetchJsonWithMetaMock(...args),
}));

import CreatorPage from "./CreatorPage.jsx";

function CreatorHarness({
  alreadySaved = true,
  onSave = vi.fn(),
  initialFilter = "",
}) {
  const [filter, setFilter] = useState(initialFilter);
  const [position, setPosition] = useState(0);
  return (
    <CreatorPage
      service="patreon"
      creatorId="50049787"
      creatorName="AYEH"
      alreadySaved={alreadySaved}
      onOpenPost={vi.fn()}
      onSave={onSave}
      activeFilter={filter}
      onUpdateFilter={setFilter}
      onRememberPosition={setPosition}
      initialPosition={position}
    />
  );
}

const setupMatchMedia = () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const setupApi = ({ posts = [], profileCount = posts.length } = {}) => {
  fetchJsonMock.mockImplementation(async (url) => {
    const target = String(url);
    if (target.includes("/profile")) {
      return {
        id: "50049787",
        service: "patreon",
        name: "AYEH",
        post_count: profileCount,
      };
    }
    if (target.includes("/posts?")) {
      const parsed = new URL(target, "https://example.invalid");
      const offset = Number(parsed.searchParams.get("o") || 0);
      const limit = Number(parsed.searchParams.get("n") || 50);
      return posts.slice(offset, offset + limit);
    }
    return [];
  });
};

describe("CreatorPage cache controls", () => {
  const service = "patreon";
  const creatorId = "50049787";
  const cachePrefKey = getCachePreferenceKey(service, creatorId);

  beforeEach(() => {
    cleanup();
    fetchJsonMock.mockReset();
    fetchJsonWithMetaMock.mockReset();
    fetchJsonWithMetaMock.mockImplementation(async (...args) => ({
      data: await fetchJsonMock(...args),
      status: 200,
      notModified: false,
      etag: "",
      lastModified: "",
    }));
    localStorage.clear();
    writeCreatorCache(service, creatorId, null);
    setupMatchMedia();
  });

  it("refreshes posts on demand when archive mode is enabled", async () => {
    localStorage.setItem(cachePrefKey, "true");
    writeCreatorCache(service, creatorId, {
      updatedAt: Date.now(),
      totalPosts: 1,
      profile: { id: creatorId, service, name: "AYEH", post_count: 1 },
      chunks: {
        0: [{ id: "cached-1", title: "Cached post", published: "2025-01-01T00:00:00.000Z" }],
      },
    });
    setupApi({
      posts: [{ id: "remote-1", title: "Remote post", published: "2025-01-02T00:00:00.000Z" }],
      profileCount: 1,
    });

    render(<CreatorHarness alreadySaved />);

    await screen.findByText("Cached post");
    const baselineProfileCalls = fetchJsonWithMetaMock.mock.calls.filter((call) =>
      String(call[0]).includes("/profile"),
    ).length;
    const baselinePostsCalls = fetchJsonWithMetaMock.mock.calls.filter((call) =>
      String(call[0]).includes("/posts?o=0&n=50"),
    ).length;

    fireEvent.click(screen.getByRole("button", { name: "Refresh posts" }));

    await waitFor(() => {
      const profileCalls = fetchJsonWithMetaMock.mock.calls.filter((call) =>
        String(call[0]).includes("/profile"),
      ).length;
      const postsCalls = fetchJsonWithMetaMock.mock.calls.filter((call) =>
        String(call[0]).includes("/posts?o=0&n=50"),
      ).length;
      expect(profileCalls).toBeGreaterThan(baselineProfileCalls);
      expect(postsCalls).toBeGreaterThan(baselinePostsCalls);
    });
  });

  it("persists archive toggle state and shows/hides refresh action accordingly", async () => {
    setupApi({
      posts: [{ id: "post-1", title: "post 1", published: "2025-01-01T00:00:00.000Z" }],
      profileCount: 1,
    });

    render(<CreatorHarness alreadySaved />);

    await screen.findByText("post 1");
    const cacheToggle = screen.getByLabelText("Archive posts locally", { selector: "#use-cache-toggle" });
    expect(cacheToggle).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Refresh posts" })).not.toBeInTheDocument();

    fireEvent.click(cacheToggle);

    await waitFor(() => {
      expect(cacheToggle).toBeChecked();
      expect(localStorage.getItem(cachePrefKey)).toBe("true");
      expect(screen.getByRole("button", { name: "Refresh posts" })).toBeInTheDocument();
    });

    fireEvent.click(cacheToggle);

    await waitFor(() => {
      expect(cacheToggle).not.toBeChecked();
      expect(localStorage.getItem(cachePrefKey)).toBe("false");
      expect(screen.queryByRole("button", { name: "Refresh posts" })).not.toBeInTheDocument();
    });
  });

  it("shows save action and hides archive controls for unsaved creators", async () => {
    const onSave = vi.fn();
    setupApi({
      posts: [{ id: "post-1", title: "post 1", published: "2025-01-01T00:00:00.000Z" }],
      profileCount: 1,
    });

    render(<CreatorHarness alreadySaved={false} onSave={onSave} />);

    await screen.findByText("post 1");
    expect(screen.queryByLabelText("Archive posts locally", { selector: "#use-cache-toggle" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save creator" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

