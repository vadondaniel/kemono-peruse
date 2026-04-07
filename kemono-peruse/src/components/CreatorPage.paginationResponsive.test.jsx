import React, { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { PAGE_SIZE_KEY } from "../constants.js";

const fetchJsonMock = vi.fn();
const fetchJsonWithMetaMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
  fetchJsonWithMeta: (...args) => fetchJsonWithMetaMock(...args),
}));

import CreatorPage from "./CreatorPage.jsx";
import { writeCreatorCache } from "../utils/cache.js";

function CreatorHarness({ initialFilter = "", alreadySaved = false }) {
  const [filter, setFilter] = useState(initialFilter);
  const [position, setPosition] = useState(0);
  return (
    <CreatorPage
      service="patreon"
      creatorId="50049787"
      creatorName="AYEH"
      alreadySaved={alreadySaved}
      onOpenPost={vi.fn()}
      onSave={vi.fn()}
      activeFilter={filter}
      onUpdateFilter={setFilter}
      onRememberPosition={setPosition}
      initialPosition={position}
    />
  );
}

const buildPosts = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `post-${index + 1}`,
    title: `post ${index + 1}`,
    published: "2025-01-01T00:00:00.000Z",
  }));

const setupMatchMediaModern = (initialMatches = false) => {
  const listeners = new Set();
  const media = {
    matches: initialMatches,
    media: "(max-width: 520px)",
    onchange: null,
    addEventListener: vi.fn((type, handler) => {
      if (type === "change") listeners.add(handler);
    }),
    removeEventListener: vi.fn((type, handler) => {
      if (type === "change") listeners.delete(handler);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  const setMatches = (next) => {
    media.matches = Boolean(next);
    listeners.forEach((handler) => handler({ matches: media.matches, media: media.media }));
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => media),
  });
  return { media, setMatches };
};

const setupMatchMediaLegacy = (initialMatches = false) => {
  const listeners = new Set();
  const media = {
    matches: initialMatches,
    media: "(max-width: 520px)",
    onchange: null,
    addListener: vi.fn((handler) => {
      listeners.add(handler);
    }),
    removeListener: vi.fn((handler) => {
      listeners.delete(handler);
    }),
    dispatchEvent: vi.fn(),
  };
  const setMatches = (next) => {
    media.matches = Boolean(next);
    listeners.forEach((handler) => handler({ matches: media.matches, media: media.media }));
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => media),
  });
  return { media, setMatches };
};

const mockPostApi = (posts) => {
  fetchJsonMock.mockImplementation(async (url) => {
    const target = String(url);
    if (target.includes("/profile")) {
      return { id: "50049787", service: "patreon", name: "AYEH", post_count: posts.length };
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

describe("CreatorPage responsive pagination", () => {
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
    writeCreatorCache("patreon", "50049787", null);
    localStorage.setItem(PAGE_SIZE_KEY, "25");
  });

  it("switches between compact and regular pagination when media query changes", async () => {
    const { setMatches } = setupMatchMediaModern(true);
    mockPostApi(buildPosts(300));

    render(<CreatorHarness />);

    await screen.findByText("post 1");
    await screen.findByText((_, element) => {
      const text = element?.textContent?.replace(/\s+/g, " ").trim() || "";
      return text === "Page 1 of 12";
    });

    expect(screen.queryAllByRole("link", { name: /next/i })).toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: /prev/i })).toHaveLength(0);

    setMatches(false);

    await waitFor(() => {
      expect(screen.queryAllByRole("link", { name: /next/i }).length).toBeGreaterThan(0);
      expect(screen.queryAllByRole("link", { name: /prev/i }).length).toBeGreaterThan(0);
    });
  });

  it("uses legacy matchMedia listeners when addEventListener is unavailable", async () => {
    const { media, setMatches } = setupMatchMediaLegacy(true);
    mockPostApi(buildPosts(300));

    const { unmount } = render(<CreatorHarness />);

    await screen.findByText("post 1");
    expect(media.addListener).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("link", { name: /next/i })).toHaveLength(0);

    setMatches(false);
    await waitFor(() => {
      expect(screen.queryAllByRole("link", { name: /next/i }).length).toBeGreaterThan(0);
    });

    unmount();
    expect(media.removeListener).toHaveBeenCalledTimes(1);
  });
});

