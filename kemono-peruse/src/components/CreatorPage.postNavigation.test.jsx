import React, { useState } from "react";
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PAGE_SIZE_KEY } from "../constants.js";

const fetchJsonMock = vi.fn();
const fetchJsonWithMetaMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
  fetchJsonWithMeta: (...args) => fetchJsonWithMetaMock(...args),
}));

import CreatorPage from "./CreatorPage.jsx";
import { writeCreatorCache } from "../utils/cache.js";

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

const buildPosts = (count, prefix = "post") =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    title: `${prefix} ${index + 1}`,
    published: "2025-01-01T00:00:00.000Z",
  }));

const setupApiForUnfilteredPosts = (posts) => {
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

const setupApiForFilteredPosts = (posts) => {
  fetchJsonMock.mockImplementation(async (url) => {
    const target = String(url);
    if (target.includes("/profile")) {
      return { id: "50049787", service: "patreon", name: "AYEH", post_count: posts.length };
    }
    if (target.includes("&q=alpha")) {
      const parsed = new URL(target, "https://example.invalid");
      const offset = Number(parsed.searchParams.get("o") || 0);
      const limit = Number(parsed.searchParams.get("n") || 50);
      return posts.slice(offset, offset + limit);
    }
    if (target.includes("&tag=alpha")) {
      return [];
    }
    if (target.includes("/posts?")) {
      return [];
    }
    return [];
  });
};

const findPageLabel = (page, total) =>
  screen.getByText((_, element) => {
    const text = element?.textContent?.replace(/\s+/g, " ").trim() || "";
    return text === `Page ${page} of ${total}`;
  });

const renderCreatorPage = ({
  initialFilter = "",
  alreadySaved = false,
  onOpenPost = vi.fn(),
  onRememberPosition = vi.fn(),
} = {}) => {
  function Harness() {
    const [filter, setFilter] = useState(initialFilter);
    const [position, setPosition] = useState(0);
    return (
      <CreatorPage
        service="patreon"
        creatorId="50049787"
        creatorName="AYEH"
        alreadySaved={alreadySaved}
        onOpenPost={onOpenPost}
        onSave={vi.fn()}
        activeFilter={filter}
        onUpdateFilter={setFilter}
        onRememberPosition={(nextPosition, meta) => {
          onRememberPosition(nextPosition, meta);
          setPosition(nextPosition);
        }}
        initialPosition={position}
      />
    );
  }
  return render(<Harness />);
};

describe("CreatorPage post navigation behavior", () => {
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

  it("opens unfiltered posts with page-aligned offset and remembers absolute position", async () => {
    setupApiForUnfilteredPosts(buildPosts(80, "post"));
    const onOpenPost = vi.fn();
    const onRememberPosition = vi.fn();

    renderCreatorPage({ onOpenPost, onRememberPosition });

    await screen.findByText("post 1");
    fireEvent.click(screen.getAllByRole("link", { name: /next/i })[0]);
    await screen.findByText("post 26");
    expect(findPageLabel(2, 4)).toBeInTheDocument();

    const postLink = screen.getByText("post 26").closest("a.post-item");
    expect(postLink).toBeTruthy();
    fireEvent.click(postLink);

    await waitFor(() => {
      expect(onOpenPost).toHaveBeenCalledWith("post-26", "post 26", 25);
    });
    expect(onRememberPosition).toHaveBeenLastCalledWith(25, expect.objectContaining({ pageSize: 25 }));
  });

  it("opens filtered posts with undefined source offset and remembers filtered page position", async () => {
    setupApiForFilteredPosts(buildPosts(60, "alpha"));
    const onOpenPost = vi.fn();
    const onRememberPosition = vi.fn();

    renderCreatorPage({
      initialFilter: "alpha",
      onOpenPost,
      onRememberPosition,
    });

    await screen.findByText("alpha 1");
    fireEvent.click(screen.getAllByRole("link", { name: /next/i })[0]);
    await waitFor(() => {
      expect(onRememberPosition).toHaveBeenCalledWith(25, expect.objectContaining({ pageSize: 25 }));
    });

    const postLink = document.querySelector(".post-item");
    expect(postLink).toBeTruthy();
    fireEvent.click(postLink);

    await waitFor(() => {
      expect(onOpenPost).toHaveBeenCalled();
    });
    expect(onOpenPost.mock.calls.at(-1)?.[2]).toBeUndefined();
    expect(onRememberPosition).toHaveBeenLastCalledWith(25, expect.objectContaining({ pageSize: 25 }));
  });

  it("does not intercept modified clicks on post links", async () => {
    setupApiForUnfilteredPosts(buildPosts(30, "post"));
    const onOpenPost = vi.fn();
    const onRememberPosition = vi.fn();

    renderCreatorPage({ onOpenPost, onRememberPosition });
    await screen.findByText("post 1");

    const postLink = screen.getByText("post 1").closest("a.post-item");
    expect(postLink).toBeTruthy();

    const ctrlClick = createEvent.click(postLink, { ctrlKey: true, button: 0 });
    const postHref = postLink.getAttribute("href");
    postLink.removeAttribute("href");
    fireEvent(postLink, ctrlClick);
    postLink.setAttribute("href", postHref);

    expect(ctrlClick.defaultPrevented).toBe(false);
    expect(onOpenPost).not.toHaveBeenCalled();
    expect(onRememberPosition).not.toHaveBeenCalled();
  });
});
