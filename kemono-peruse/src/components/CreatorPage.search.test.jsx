import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.fn();
const fetchJsonWithMetaMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
  fetchJsonWithMeta: (...args) => fetchJsonWithMetaMock(...args),
}));

import CreatorPage from "./CreatorPage.jsx";
import { writeCreatorCache } from "../utils/cache.js";
import { PAGE_SIZE_KEY } from "../constants.js";

function CreatorHarness({ initialFilter = "alpha", alreadySaved = false, initialPosition = 0 }) {
  const [filter, setFilter] = useState(initialFilter);
  const [position, setPosition] = useState(initialPosition);
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

describe("CreatorPage search behavior", () => {
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
    setupMatchMedia();
  });

  it("uses tag mode with body=true when tags-only filter is active", async () => {
    localStorage.setItem(
      "kemono.filterFields.patreon.50049787",
      JSON.stringify({ title: false, tags: true, body: false }),
    );

    fetchJsonMock.mockImplementation(async (url) => {
      if (url.includes("/profile")) {
        return { id: "50049787", service: "patreon", name: "AYEH", post_count: 1 };
      }
      if (url.includes("&tag=alpha")) {
        return [{ id: "tag-post", title: "Tagged Post", tags: ["alpha"] }];
      }
      return [];
    });

    render(<CreatorHarness initialFilter="alpha" />);

    await screen.findByText("Tagged Post");

    const urls = fetchJsonMock.mock.calls.map((call) => String(call[0]));
    const tagUrl = urls.find((url) => url.includes("&tag=alpha"));
    expect(tagUrl).toBeTruthy();
    expect(tagUrl).toContain("&title=false");
    expect(tagUrl).toContain("&tags=true");
    expect(tagUrl).toContain("&body=true");
  });

  it("combines title/body and tag matches as OR when both are enabled", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      if (url.includes("/profile")) {
        return { id: "50049787", service: "patreon", name: "AYEH", post_count: 3 };
      }
      if (url.includes("&q=alpha")) {
        return [
          { id: "text-match", title: "alpha title", tags: ["zzz"] },
          { id: "not-a-match", title: "completely different", tags: ["zzz"] },
        ];
      }
      if (url.includes("&tag=alpha")) {
        return [{ id: "tag-match", title: "plain title", tags: ["alpha"] }];
      }
      return [];
    });

    render(<CreatorHarness initialFilter="alpha" />);

    await screen.findByText("alpha title");
    await screen.findByText("plain title");

    expect(screen.queryByText("completely different")).not.toBeInTheDocument();

    const urls = fetchJsonMock.mock.calls.map((call) => String(call[0]));
    const textUrl = urls.find((url) => url.includes("&q=alpha"));
    const tagUrl = urls.find((url) => url.includes("&tag=alpha"));
    expect(textUrl).toBeTruthy();
    expect(tagUrl).toBeTruthy();
    expect(textUrl).toContain("&tags=false");
    expect(tagUrl).toContain("&title=false");
  });

  it("keeps tag-only matches when title and tags are both enabled", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      if (url.includes("/profile")) {
        return { id: "50049787", service: "patreon", name: "AYEH", post_count: 76 };
      }
      if (url.includes("&q=AYEH")) {
        return [];
      }
      if (url.includes("&tag=ayeh")) {
        if (url.includes("&title=false&tags=true&body=true")) {
          return [{ id: "tag-only-match", title: "Tag only post", tags: ["ayeh"] }];
        }
        return [];
      }
      return [];
    });

    render(<CreatorHarness initialFilter="AYEH" />);

    await screen.findByText("Tag only post");

    const urls = fetchJsonMock.mock.calls.map((call) => String(call[0]));
    const tagUrl = urls.find((url) => url.includes("&tag=ayeh"));
    expect(tagUrl).toContain("&title=false&tags=true&body=true");
  });

  it("resets filter state when clear is clicked", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      if (url.includes("/profile")) {
        return { id: "50049787", service: "patreon", name: "AYEH", post_count: 1 };
      }
      if (url.includes("&q=alpha")) {
        return [{ id: "text-match", title: "alpha title", tags: ["zzz"] }];
      }
      return [];
    });

    render(<CreatorHarness initialFilter="alpha" />);
    await screen.findByText("alpha title");

    const clearButton = screen.getByRole("button", { name: /clear/i });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(screen.queryByText("alpha title")).not.toBeInTheDocument();
    });
  });

  it("uses stale-while-revalidate for cached post lists and keeps removed posts archived", async () => {
    localStorage.setItem("kemono.cache.pref.patreon.50049787", "true");
    writeCreatorCache("patreon", "50049787", {
      updatedAt: 1,
      totalPosts: 1,
      profile: { id: "50049787", service: "patreon", name: "AYEH", post_count: 1 },
      chunks: {
        0: [{ id: "cached-post", title: "Cached title", published: "2025-01-01T00:00:00.000Z" }],
      },
    });

    let resolvePosts;
    fetchJsonMock.mockImplementation((url) => {
      const target = String(url);
      if (target.includes("/profile")) {
        return Promise.resolve({ id: "50049787", service: "patreon", name: "AYEH", post_count: 2 });
      }
      if (target.includes("/posts?o=0&n=50")) {
        return new Promise((resolve) => {
          resolvePosts = resolve;
        });
      }
      return Promise.resolve([]);
    });

    render(<CreatorHarness initialFilter="" alreadySaved />);

    await screen.findByText("Cached title");
    expect(screen.getByText("Showing 1 items")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchJsonMock.mock.calls.some((call) => String(call[0]).includes("/posts?o=0&n=50"))).toBe(true);
    });

    resolvePosts([
      { id: "fresh-post", title: "Fresh title", published: "2025-01-02T00:00:00.000Z" },
    ]);
    await screen.findByText("Fresh title");
    expect(screen.getByText("Cached title")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("sends conditional headers for cache revalidation and keeps cached chunks on 304", async () => {
    localStorage.setItem("kemono.cache.pref.patreon.50049787", "true");
    writeCreatorCache("patreon", "50049787", {
      updatedAt: 1,
      totalPosts: 1,
      profile: { id: "50049787", service: "patreon", name: "AYEH", post_count: 1 },
      chunks: {
        0: [{ id: "cached-post", title: "Cached title", published: "2025-01-01T00:00:00.000Z" }],
      },
      revalidation: {
        profile: {
          etag: '"profile-v1"',
          lastModified: "Tue, 01 Apr 2025 12:00:00 GMT",
        },
        chunks: {
          0: {
            etag: '"chunk-v1"',
            lastModified: "Tue, 01 Apr 2025 12:05:00 GMT",
          },
        },
      },
    });

    const metaCalls = [];
    fetchJsonWithMetaMock.mockImplementation(async (url, options = {}) => {
      const target = String(url);
      metaCalls.push({ url: target, headers: options?.headers || {} });
      if (target.includes("/profile")) {
        return {
          data: null,
          status: 304,
          notModified: true,
          etag: '"profile-v1"',
          lastModified: "Tue, 01 Apr 2025 12:00:00 GMT",
        };
      }
      if (target.includes("/posts?o=0&n=50")) {
        return {
          data: null,
          status: 304,
          notModified: true,
          etag: '"chunk-v1"',
          lastModified: "Tue, 01 Apr 2025 12:05:00 GMT",
        };
      }
      return { data: [], status: 200, notModified: false, etag: "", lastModified: "" };
    });

    render(<CreatorHarness initialFilter="" alreadySaved />);

    await screen.findByText("Cached title");
    await waitFor(() => {
      expect(metaCalls.some((call) => call.url.includes("/posts?o=0&n=50"))).toBe(true);
    });

    const profileCall = metaCalls.find((call) => call.url.includes("/profile"));
    const postsCall = metaCalls.find((call) => call.url.includes("/posts?o=0&n=50"));
    expect(profileCall?.headers).toMatchObject({
      "If-None-Match": '"profile-v1"',
      "If-Modified-Since": "Tue, 01 Apr 2025 12:00:00 GMT",
    });
    expect(postsCall?.headers).toMatchObject({
      "If-None-Match": '"chunk-v1"',
      "If-Modified-Since": "Tue, 01 Apr 2025 12:05:00 GMT",
    });
    expect(screen.getByText("Cached title")).toBeInTheDocument();
  });

  it("uses stale archive results immediately and keeps them when source filtering returns empty", async () => {
    localStorage.setItem("kemono.cache.pref.patreon.50049787", "true");
    localStorage.setItem(
      "kemono.filterFields.patreon.50049787",
      JSON.stringify({ title: true, tags: false, body: false }),
    );
    writeCreatorCache("patreon", "50049787", {
      updatedAt: 1,
      totalPosts: 2,
      profile: { id: "50049787", service: "patreon", name: "AYEH", post_count: 2 },
      chunks: {
        0: [
          {
            id: "archive-match",
            title: "alpha cached post",
            archivedOnly: true,
            published: "2025-01-01T00:00:00.000Z",
          },
          {
            id: "other-post",
            title: "beta cached post",
            published: "2025-01-02T00:00:00.000Z",
          },
        ],
      },
    });

    let resolveSourceFilter;
    fetchJsonMock.mockImplementation((url) => {
      const target = String(url);
      if (target.includes("/profile")) {
        return Promise.resolve({ id: "50049787", service: "patreon", name: "AYEH", post_count: 2 });
      }
      if (target.includes("&q=alpha")) {
        return new Promise((resolve) => {
          resolveSourceFilter = resolve;
        });
      }
      return Promise.resolve([]);
    });

    render(<CreatorHarness initialFilter="alpha" alreadySaved />);

    await screen.findByText("alpha cached post");
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("Using archive results; syncing with source...")).toBeInTheDocument();

    await waitFor(() => {
      expect(typeof resolveSourceFilter).toBe("function");
    });
    resolveSourceFilter([]);
    await waitFor(() => {
      expect(screen.getByText("alpha cached post")).toBeInTheDocument();
    });
    expect(screen.queryByText("Using archive results; syncing with source...")).not.toBeInTheDocument();
  });

  it("keeps archive matches visible when source filtering fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      localStorage.setItem("kemono.cache.pref.patreon.50049787", "true");
      localStorage.setItem(
        "kemono.filterFields.patreon.50049787",
        JSON.stringify({ title: true, tags: false, body: false }),
      );
      writeCreatorCache("patreon", "50049787", {
        updatedAt: 1,
        totalPosts: 1,
        profile: { id: "50049787", service: "patreon", name: "AYEH", post_count: 1 },
        chunks: {
          0: [{ id: "archive-match", title: "alpha offline post", published: "2025-01-01T00:00:00.000Z" }],
        },
      });

      fetchJsonMock.mockImplementation((url) => {
        const target = String(url);
        if (target.includes("/profile")) {
          return Promise.resolve({ id: "50049787", service: "patreon", name: "AYEH", post_count: 1 });
        }
        if (target.includes("&q=alpha")) {
          return Promise.reject(new Error("source unavailable"));
        }
        return Promise.resolve([]);
      });

      render(<CreatorHarness initialFilter="alpha" alreadySaved />);

      await screen.findByText("alpha offline post");
      await screen.findByText("Using archive results (source unavailable)");
      expect(screen.getByText("alpha offline post")).toBeInTheDocument();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("merges source filter matches into archive results without duplicates", async () => {
    localStorage.setItem("kemono.cache.pref.patreon.50049787", "true");
    localStorage.setItem(
      "kemono.filterFields.patreon.50049787",
      JSON.stringify({ title: true, tags: false, body: false }),
    );
    writeCreatorCache("patreon", "50049787", {
      updatedAt: 1,
      totalPosts: 2,
      profile: { id: "50049787", service: "patreon", name: "AYEH", post_count: 2 },
      chunks: {
        0: [
          {
            id: "shared-post",
            title: "alpha local old",
            archivedOnly: true,
            published: "2025-01-01T00:00:00.000Z",
          },
          {
            id: "local-only-post",
            title: "alpha local keep",
            published: "2025-01-01T00:10:00.000Z",
          },
        ],
      },
    });

    fetchJsonMock.mockImplementation((url) => {
      const target = String(url);
      if (target.includes("/profile")) {
        return Promise.resolve({ id: "50049787", service: "patreon", name: "AYEH", post_count: 3 });
      }
      if (target.includes("&q=alpha")) {
        return Promise.resolve([
          { id: "shared-post", title: "alpha remote updated", published: "2025-01-03T00:00:00.000Z" },
          { id: "remote-new-post", title: "alpha remote new", published: "2025-01-03T00:10:00.000Z" },
        ]);
      }
      return Promise.resolve([]);
    });

    render(<CreatorHarness initialFilter="alpha" alreadySaved />);

    await screen.findByText("alpha remote updated");
    expect(screen.queryByText("alpha local old")).not.toBeInTheDocument();
    expect(screen.getByText("alpha local keep")).toBeInTheDocument();
    expect(screen.getByText("alpha remote new")).toBeInTheDocument();
    expect(screen.queryAllByText("alpha remote updated")).toHaveLength(1);
    expect(screen.queryByText("Archived")).not.toBeInTheDocument();
  });

  it("paginates deterministic archive filter results and keeps page stable on source failure", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      localStorage.setItem("kemono.cache.pref.patreon.50049787", "true");
      localStorage.setItem(PAGE_SIZE_KEY, "50");
      localStorage.setItem(
        "kemono.filterFields.patreon.50049787",
        JSON.stringify({ title: true, tags: false, body: false }),
      );
      const cachedPosts = Array.from({ length: 120 }, (_, index) => ({
        id: `page-${index + 1}`,
        title: `alpha ${index + 1}`,
        published: `2025-01-01T${String(Math.floor(index / 6)).padStart(2, "0")}:${String((index % 6) * 10).padStart(2, "0")}:00.000Z`,
      }));
      writeCreatorCache("patreon", "50049787", {
        updatedAt: 1,
        totalPosts: cachedPosts.length,
        profile: { id: "50049787", service: "patreon", name: "AYEH", post_count: cachedPosts.length },
        chunks: {
          0: cachedPosts,
        },
      });

      let rejectSourceFilter;
      fetchJsonMock.mockImplementation((url) => {
        const target = String(url);
        if (target.includes("/profile")) {
          return Promise.resolve({ id: "50049787", service: "patreon", name: "AYEH", post_count: cachedPosts.length });
        }
        if (target.includes("&q=alpha")) {
          return new Promise((_, reject) => {
            rejectSourceFilter = reject;
          });
        }
        return Promise.resolve([]);
      });

      render(<CreatorHarness initialFilter="alpha" alreadySaved />);

      await screen.findByText("alpha 1");
      expect(screen.queryByText("alpha 51")).not.toBeInTheDocument();
      fireEvent.click(screen.getAllByRole("link", { name: /next/i })[0]);
      await screen.findByText("alpha 51");
      expect(screen.queryByText("alpha 1")).not.toBeInTheDocument();
      fireEvent.click(screen.getAllByRole("link", { name: /next/i })[0]);
      expect(screen.getByText("alpha 101")).toBeInTheDocument();

      await waitFor(() => {
        expect(typeof rejectSourceFilter).toBe("function");
      });
      rejectSourceFilter(new Error("source unavailable"));
      await screen.findByText("Using archive results (source unavailable)");

      expect(screen.getByText("alpha 101")).toBeInTheDocument();
    } finally {
      consoleSpy.mockRestore();
    }
  }, 15000);
});
