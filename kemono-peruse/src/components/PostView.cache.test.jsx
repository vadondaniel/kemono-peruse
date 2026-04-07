import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
}));

import PostView from "./PostView.jsx";
import { writeCreatorCache } from "../utils/cache.js";

const noop = () => {};

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

const buildCachedPost = (title) => ({
  id: "148264629",
  title,
  published: "2025-01-01T10:30:00.000Z",
  content: "<p>Cached body</p>",
  tags: ["cached"],
  attachments: [],
});

describe("PostView archive cache behavior", () => {
  beforeEach(() => {
    cleanup();
    fetchJsonMock.mockReset();
    localStorage.clear();
    setupMatchMedia();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps rendering stale cached detail when refresh fails", async () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000_000);
    localStorage.setItem("kemono.cache.pref.patreon.50049787", "true");
    writeCreatorCache("patreon", "50049787", {
      updatedAt: 1,
      postDetails: {
        "148264629": {
          data: buildCachedPost("Cached Post"),
          updatedAt: 1,
          hydrated: true,
        },
      },
    });

    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return null;
      }
      return [];
    });

    render(
      <PostView
        service="patreon"
        creatorId="50049787"
        creatorName="AYEH"
        postId="148264629"
        alreadySaved
        creatorPosition={0}
        activeFilter=""
        readerSettingsOpen={false}
        onCloseReaderSettings={noop}
        onBack={noop}
        onNavigate={noop}
        onResolvePostTitle={noop}
        onResolveCreatorPosition={noop}
      />,
    );

    await screen.findByText("Cached Post");
    await screen.findByText("Using stale archive copy (offline or source unavailable).");
  });

  it("shows cached detail first and updates after background refresh succeeds", async () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000_000);
    localStorage.setItem("kemono.cache.pref.patreon.50049787", "true");
    writeCreatorCache("patreon", "50049787", {
      updatedAt: 1,
      postDetails: {
        "148264629": {
          data: buildCachedPost("Cached Post"),
          updatedAt: 1,
          hydrated: true,
        },
      },
    });

    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return {
          post: {
            ...buildCachedPost("Fresh Post"),
            tags: ["fresh"],
            content: "<p>Fresh body</p>",
          },
          attachments: [],
        };
      }
      return [];
    });

    render(
      <PostView
        service="patreon"
        creatorId="50049787"
        creatorName="AYEH"
        postId="148264629"
        alreadySaved
        creatorPosition={0}
        activeFilter=""
        readerSettingsOpen={false}
        onCloseReaderSettings={noop}
        onBack={noop}
        onNavigate={noop}
        onResolvePostTitle={noop}
        onResolveCreatorPosition={noop}
      />,
    );

    await screen.findByText("Cached Post");
    await screen.findByText("Fresh Post");
    await waitFor(() => {
      expect(screen.queryByText("Cached Post")).not.toBeInTheDocument();
    });
  });

  it("resolves Prev/Next from filtered archive results in open post view", async () => {
    vi.spyOn(Date, "now").mockReturnValue(200_000_000);
    localStorage.setItem("kemono.cache.pref.patreon.50049787", "true");
    localStorage.setItem(
      "kemono.filterFields.patreon.50049787",
      JSON.stringify({ title: true, tags: true, body: false }),
    );
    writeCreatorCache("patreon", "50049787", {
      updatedAt: 1,
      chunks: {
        0: [
          { id: "post-newer", title: "alpha newer", published: "2025-01-03T00:00:00.000Z" },
          {
            id: "148264629",
            title: "middle post",
            tags: ["alpha"],
            published: "2025-01-02T00:00:00.000Z",
          },
          {
            id: "post-older",
            title: "alpha older archived",
            archivedOnly: true,
            published: "2025-01-01T00:00:00.000Z",
          },
        ],
      },
      postDetails: {
        "148264629": {
          data: {
            ...buildCachedPost("Current Post"),
            id: "148264629",
            tags: ["alpha"],
          },
          updatedAt: 200_000_000,
          hydrated: true,
        },
      },
    });

    fetchJsonMock.mockResolvedValue([]);
    const onNavigate = vi.fn();

    render(
      <PostView
        service="patreon"
        creatorId="50049787"
        creatorName="AYEH"
        postId="148264629"
        alreadySaved
        creatorPosition={0}
        activeFilter="alpha"
        readerSettingsOpen={false}
        onCloseReaderSettings={noop}
        onBack={noop}
        onNavigate={onNavigate}
        onResolvePostTitle={noop}
        onResolveCreatorPosition={noop}
      />,
    );

    await screen.findByText("Current Post");

    const prevButton = screen.getAllByRole("link", { name: /prev/i })[0];
    const nextButton = screen.getAllByRole("link", { name: /next/i })[0];
    expect(prevButton.getAttribute("aria-disabled")).toBe("false");
    expect(nextButton.getAttribute("aria-disabled")).toBe("false");

    fireEvent.click(prevButton);
    fireEvent.click(nextButton);

    expect(onNavigate).toHaveBeenNthCalledWith(1, "post-older");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "post-newer");
    expect(fetchJsonMock.mock.calls.some((call) => String(call[0]).includes("/posts?"))).toBe(false);
  });
});
