import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PAGE_SIZE_KEY } from "../constants.js";

const fetchJsonMock = vi.fn();
const fetchJsonWithMetaMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
  fetchJsonWithMeta: (...args) => fetchJsonWithMetaMock(...args),
}));

import CreatorPage from "./CreatorPage.jsx";
import { writeCreatorCache } from "../utils/cache.js";

function CreatorHarness({
  initialFilter = "",
  initialPosition = 0,
  alreadySaved = false,
  onOpenPost = vi.fn(),
  onRememberPosition = vi.fn(),
}) {
  const [filter, setFilter] = useState(initialFilter);
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
      onRememberPosition={onRememberPosition}
      initialPosition={initialPosition}
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

const buildPosts = (count, prefix = "post") =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    title: `${prefix} ${index + 1}`,
    published: "2025-01-01T00:00:00.000Z",
  }));

const setupUnfilteredApi = (posts) => {
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

const setupFilteredApi = (posts) => {
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
    return [];
  });
};

const findPageLabel = (page, total) =>
  screen.getByText((_, element) => {
    const text = element?.textContent?.replace(/\s+/g, " ").trim() || "";
    return text === `Page ${page} of ${total}`;
  });

describe("CreatorPage page-size control behavior", () => {
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

  it("falls back to API default for invalid page-size values and remembers page 0 when unfiltered", async () => {
    setupUnfilteredApi(buildPosts(80, "post"));
    const onRememberPosition = vi.fn();

    render(<CreatorHarness onRememberPosition={onRememberPosition} />);

    await screen.findByText("post 1");
    fireEvent.click(screen.getAllByRole("link", { name: /next/i })[0]);
    await screen.findByText("post 26");
    expect(findPageLabel(2, 4)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Page size", { selector: "#page-size" }), {
      target: { value: "999" },
    });

    await waitFor(() => {
      expect(findPageLabel(1, 2)).toBeInTheDocument();
    });
    expect(screen.getByText("post 1")).toBeInTheDocument();
    expect(screen.queryByText("post 51")).not.toBeInTheDocument();
    expect(onRememberPosition).toHaveBeenLastCalledWith(0, expect.objectContaining({ pageSize: 50 }));
  });

  it("resets filtered pagination to first page on page-size change without remembering unfiltered position", async () => {
    setupFilteredApi(buildPosts(80, "alpha"));
    const onRememberPosition = vi.fn();

    render(
      <CreatorHarness
        initialFilter="alpha"
        initialPosition={25}
        onRememberPosition={onRememberPosition}
      />,
    );

    await screen.findByText("alpha 26");
    expect(findPageLabel(2, 4)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Page size", { selector: "#page-size" }), {
      target: { value: "100" },
    });

    await waitFor(() => {
      expect(screen.queryAllByRole("link", { name: /next/i })).toHaveLength(0);
    });
    expect(onRememberPosition).not.toHaveBeenCalled();
  });
});
