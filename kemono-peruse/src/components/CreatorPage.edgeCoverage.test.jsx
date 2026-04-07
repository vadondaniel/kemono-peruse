import React, { useState } from "react";
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { PAGE_SIZE_KEY } from "../constants.js";
import { getCachePreferenceKey, writeCreatorCache } from "../utils/cache.js";

const fetchJsonMock = vi.fn();
const fetchJsonWithMetaMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
  fetchJsonWithMeta: (...args) => fetchJsonWithMetaMock(...args),
}));

import CreatorPage from "./CreatorPage.jsx";

function CreatorHarness({ initialFilter = "", alreadySaved = true }) {
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

const buildPosts = (count, prefix = "post", options = {}) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    title: `${prefix} ${index + 1}`,
    published: "2025-01-01T00:00:00.000Z",
    ...(options.withTags ? { tags: ["tag-a", "tag-b"] } : {}),
  }));

const findPageLabel = (page, total) =>
  screen.getByText((_, element) => {
    const text = element?.textContent?.replace(/\s+/g, " ").trim() || "";
    return text === `Page ${page} of ${total}`;
  });

describe("CreatorPage edge coverage", () => {
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
    setupMatchMedia();
  });

  it("guards disabled pagination links and active page pills while still navigating pages", async () => {
    const posts = buildPosts(60);
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

    render(<CreatorHarness />);

    await screen.findByText("post 1");
    expect(findPageLabel(1, 3)).toBeInTheDocument();

    const prevLink = screen.getAllByRole("link", { name: /prev/i })[0];
    const prevClick = createEvent.click(prevLink, { button: 0 });
    fireEvent(prevLink, prevClick);
    expect(prevClick.defaultPrevented).toBe(true);
    expect(findPageLabel(1, 3)).toBeInTheDocument();

    const pageList = document.querySelector(".pagination-pages");
    expect(pageList).toBeTruthy();
    const activeLink = pageList.querySelector("a[aria-current='page']");
    expect(activeLink).toBeTruthy();
    const activeClick = createEvent.click(activeLink, { button: 0 });
    fireEvent(activeLink, activeClick);
    expect(activeClick.defaultPrevented).toBe(true);

    const pageTwo = within(pageList).getByRole("link", { name: "2" });
    const pageTwoClick = createEvent.click(pageTwo, { button: 0 });
    fireEvent(pageTwo, pageTwoClick);
    expect(pageTwoClick.defaultPrevented).toBe(true);
    await screen.findByText("post 26");

    fireEvent.click(screen.getAllByRole("link", { name: /next/i })[0]);
    await screen.findByText("post 51");
    expect(findPageLabel(3, 3)).toBeInTheDocument();

    const nextLink = screen.getAllByRole("link", { name: /next/i })[0];
    const nextClick = createEvent.click(nextLink, { button: 0 });
    fireEvent(nextLink, nextClick);
    expect(nextClick.defaultPrevented).toBe(true);
    expect(findPageLabel(3, 3)).toBeInTheDocument();
  }, 15000);

  it("handles avatar image errors and updates filter/display controls from input events", async () => {
    const posts = buildPosts(1, "post", { withTags: true });
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/profile")) {
        return { id: "50049787", service: "patreon", name: "AYEH", post_count: posts.length };
      }
      if (target.includes("/posts?")) {
        return posts;
      }
      return [];
    });

    render(<CreatorHarness />);

    await screen.findByText("post 1");

    const avatar = screen.getByRole("img", { name: /avatar/i });
    fireEvent.error(avatar);
    expect(avatar.style.visibility).toBe("hidden");

    const searchInput = screen.getByPlaceholderText("Filter by title, tag, or text");
    fireEvent.change(searchInput, { target: { value: "alpha query" } });
    expect(searchInput).toHaveValue("alpha query");

    const filterTagsToggle = screen.getByLabelText("Tags", { selector: "#filter-tags" });
    expect(filterTagsToggle).toBeChecked();
    fireEvent.click(filterTagsToggle);
    expect(filterTagsToggle).not.toBeChecked();

    const showTagsToggle = screen.getByLabelText("Tags", { selector: "#show-tags" });
    fireEvent.click(showTagsToggle);
    await screen.findByText("tag-a");
    expect(screen.getByText("tag-b")).toBeInTheDocument();
  });

  it("shows cache fallback message when profile validation fails against source", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cachePrefKey = getCachePreferenceKey("patreon", "50049787");
    localStorage.setItem(cachePrefKey, "true");
    writeCreatorCache("patreon", "50049787", {
      updatedAt: 1,
      totalPosts: 1,
      profile: { id: "50049787", service: "patreon", name: "AYEH", post_count: 1 },
      chunks: {
        0: [{ id: "cached-post", title: "Cached post", published: "2025-01-01T00:00:00.000Z" }],
      },
    });

    fetchJsonWithMetaMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/profile")) {
        throw new Error("profile source unavailable");
      }
      if (target.includes("/posts?")) {
        throw new Error("posts source unavailable");
      }
      return { data: null, status: 200, notModified: false, etag: "", lastModified: "" };
    });

    try {
      render(<CreatorHarness alreadySaved />);

      await screen.findByText("Cached post");
      await screen.findByText("Source unavailable. Using archive copy.");
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("logs unfiltered post-load failures and keeps the list empty", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    fetchJsonWithMetaMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/profile")) {
        return {
          data: { id: "50049787", service: "patreon", name: "AYEH", post_count: 1 },
          status: 200,
          notModified: false,
          etag: "",
          lastModified: "",
        };
      }
      if (target.includes("/posts?")) {
        throw new Error("posts unavailable");
      }
      return { data: [], status: 200, notModified: false, etag: "", lastModified: "" };
    });

    try {
      render(<CreatorHarness />);

      await waitFor(() => {
        expect(
          consoleSpy.mock.calls.some((call) => call[0] === "Failed to load posts" && call[1] instanceof Error),
        ).toBe(true);
      });
      await waitFor(() => {
        expect(screen.getByText("No posts found for this page.")).toBeInTheDocument();
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("logs detailed post fetch failures for filtered results", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/profile")) {
        return { id: "50049787", service: "patreon", name: "AYEH", post_count: 1 };
      }
      if (target.includes("&q=alpha")) {
        return [{ id: "p-1", title: "Alpha 1", published: "2025-01-01T00:00:00.000Z" }];
      }
      if (target.includes("&tag=alpha")) {
        return [];
      }
      if (target.includes("/post/p-1")) {
        throw new Error("detail lookup failed");
      }
      if (target.includes("/posts?")) {
        return [];
      }
      return [];
    });

    try {
      render(<CreatorHarness initialFilter="alpha" />);

      await screen.findByText("Alpha 1");
      fireEvent.click(screen.getByLabelText("Excerpts", { selector: "#show-excerpts" }));

      await waitFor(() => {
        expect(
          consoleSpy.mock.calls.some(
            (call) => call[0] === "Failed to load detailed post content" && call[1] === "p-1" && call[2] instanceof Error,
          ),
        ).toBe(true);
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("logs unfiltered chunk-detail and fallback-detail fetch failures", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    fetchJsonWithMetaMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/profile")) {
        return {
          data: { id: "50049787", service: "patreon", name: "AYEH", post_count: 1 },
          status: 200,
          notModified: false,
          etag: "",
          lastModified: "",
        };
      }
      if (target.includes("/posts?")) {
        return {
          data: [{ id: "u-1", title: "Unfiltered 1", published: "2025-01-01T00:00:00.000Z" }],
          status: 200,
          notModified: false,
          etag: "",
          lastModified: "",
        };
      }
      return { data: [], status: 200, notModified: false, etag: "", lastModified: "" };
    });

    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/posts?")) {
        throw new Error("chunk detail unavailable");
      }
      if (target.includes("/post/u-1")) {
        throw new Error("fallback detail unavailable");
      }
      return [];
    });

    try {
      render(<CreatorHarness />);

      await screen.findByText("Unfiltered 1");
      fireEvent.click(screen.getByLabelText("Excerpts", { selector: "#show-excerpts" }));

      await waitFor(() => {
        expect(
          consoleSpy.mock.calls.some((call) => call[0] === "Failed to load post details" && call[1] instanceof Error),
        ).toBe(true);
      });
      expect(
        consoleSpy.mock.calls.some(
          (call) => call[0] === "Failed to load detailed post content" && call[1] === "u-1" && call[2] instanceof Error,
        ),
      ).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
