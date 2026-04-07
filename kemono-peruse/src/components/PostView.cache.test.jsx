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

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

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
        hasExplicitCreatorPosition
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
        hasExplicitCreatorPosition
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
        hasExplicitCreatorPosition
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

  it("publishes creator position in unfiltered mode and updates it as the viewed post changes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(300_000_000);
    localStorage.setItem("kemono.cache.pref.patreon.50049787", "true");
    writeCreatorCache("patreon", "50049787", {
      updatedAt: 1,
      chunks: {
        0: [
          { id: "post-newer", title: "newer post", published: "2025-01-03T00:00:00.000Z" },
          { id: "148264629", title: "middle post", published: "2025-01-02T00:00:00.000Z" },
          { id: "post-older", title: "older post", published: "2025-01-01T00:00:00.000Z" },
        ],
      },
      postDetails: {
        "post-newer": {
          data: { ...buildCachedPost("Newer Post"), id: "post-newer", published: "2025-01-03T00:00:00.000Z" },
          updatedAt: 300_000_000,
          hydrated: true,
        },
        "148264629": {
          data: { ...buildCachedPost("Middle Post"), id: "148264629", published: "2025-01-02T00:00:00.000Z" },
          updatedAt: 300_000_000,
          hydrated: true,
        },
        "post-older": {
          data: { ...buildCachedPost("Older Post"), id: "post-older", published: "2025-01-01T00:00:00.000Z" },
          updatedAt: 300_000_000,
          hydrated: true,
        },
      },
    });

    fetchJsonMock.mockResolvedValue([]);
    const onResolveCreatorPosition = vi.fn();

    const { rerender } = render(
      <PostView
        service="patreon"
        creatorId="50049787"
        creatorName="AYEH"
        postId="148264629"
        alreadySaved
        creatorPosition={0}
        hasExplicitCreatorPosition
        activeFilter=""
        readerSettingsOpen={false}
        onCloseReaderSettings={noop}
        onBack={noop}
        onNavigate={noop}
        onResolvePostTitle={noop}
        onResolveCreatorPosition={onResolveCreatorPosition}
      />,
    );

    await screen.findByText("Middle Post");
    await waitFor(() => {
      expect(onResolveCreatorPosition).toHaveBeenCalledWith(1, { pageSize: 50 });
    });

    rerender(
      <PostView
        service="patreon"
        creatorId="50049787"
        creatorName="AYEH"
        postId="post-older"
        alreadySaved
        creatorPosition={0}
        hasExplicitCreatorPosition
        activeFilter=""
        readerSettingsOpen={false}
        onCloseReaderSettings={noop}
        onBack={noop}
        onNavigate={noop}
        onResolvePostTitle={noop}
        onResolveCreatorPosition={onResolveCreatorPosition}
      />,
    );

    await screen.findByText("Older Post");
    await waitFor(() => {
      expect(onResolveCreatorPosition).toHaveBeenCalledWith(2, { pageSize: 50 });
    });
  });

  it("publishes creator position in filtered mode and updates it as the viewed post changes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(400_000_000);
    localStorage.setItem("kemono.cache.pref.patreon.50049787", "true");
    writeCreatorCache("patreon", "50049787", {
      updatedAt: 1,
      chunks: {
        0: [
          { id: "post-newer", title: "alpha newer", published: "2025-01-03T00:00:00.000Z" },
          { id: "148264629", title: "alpha middle", published: "2025-01-02T00:00:00.000Z" },
          { id: "post-older", title: "alpha older", published: "2025-01-01T00:00:00.000Z" },
        ],
      },
      postDetails: {
        "post-newer": {
          data: { ...buildCachedPost("Alpha Newer"), id: "post-newer", tags: ["alpha"], published: "2025-01-03T00:00:00.000Z" },
          updatedAt: 400_000_000,
          hydrated: true,
        },
        "148264629": {
          data: { ...buildCachedPost("Alpha Middle"), id: "148264629", tags: ["alpha"], published: "2025-01-02T00:00:00.000Z" },
          updatedAt: 400_000_000,
          hydrated: true,
        },
        "post-older": {
          data: { ...buildCachedPost("Alpha Older"), id: "post-older", tags: ["alpha"], published: "2025-01-01T00:00:00.000Z" },
          updatedAt: 400_000_000,
          hydrated: true,
        },
      },
    });

    fetchJsonMock.mockResolvedValue([]);
    const onResolveCreatorPosition = vi.fn();

    const { rerender } = render(
      <PostView
        service="patreon"
        creatorId="50049787"
        creatorName="AYEH"
        postId="148264629"
        alreadySaved
        creatorPosition={0}
        hasExplicitCreatorPosition
        activeFilter="alpha"
        readerSettingsOpen={false}
        onCloseReaderSettings={noop}
        onBack={noop}
        onNavigate={noop}
        onResolvePostTitle={noop}
        onResolveCreatorPosition={onResolveCreatorPosition}
      />,
    );

    await screen.findByText("Alpha Middle");
    await waitFor(() => {
      expect(onResolveCreatorPosition).toHaveBeenCalledWith(1, { pageSize: 50 });
    });

    rerender(
      <PostView
        service="patreon"
        creatorId="50049787"
        creatorName="AYEH"
        postId="post-newer"
        alreadySaved
        creatorPosition={0}
        hasExplicitCreatorPosition
        activeFilter="alpha"
        readerSettingsOpen={false}
        onCloseReaderSettings={noop}
        onBack={noop}
        onNavigate={noop}
        onResolvePostTitle={noop}
        onResolveCreatorPosition={onResolveCreatorPosition}
      />,
    );

    await screen.findByText("Alpha Newer");
    await waitFor(() => {
      expect(onResolveCreatorPosition).toHaveBeenCalledWith(0, { pageSize: 50 });
    });
  });

  it("disables Posts while resolving a direct-link position and enables it after position resolves", async () => {
    const neighborsDeferred = createDeferred();
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return {
          post: {
            ...buildCachedPost("Middle Post"),
            id: "148264629",
          },
          attachments: [],
        };
      }
      if (target.includes("/posts?")) {
        return neighborsDeferred.promise;
      }
      return [];
    });

    render(
      <PostView
        service="patreon"
        creatorId="50049787"
        creatorName="AYEH"
        postId="148264629"
        alreadySaved={false}
        creatorPosition={0}
        hasExplicitCreatorPosition={false}
        activeFilter=""
        readerSettingsOpen={false}
        onCloseReaderSettings={noop}
        onBack={noop}
        onNavigate={noop}
        onResolvePostTitle={noop}
        onResolveCreatorPosition={noop}
      />,
    );

    await screen.findByText("Middle Post");
    const postsButtons = screen.getAllByRole("link", { name: "Posts" });
    expect(postsButtons[0]).toHaveAttribute("aria-disabled", "true");

    neighborsDeferred.resolve([{ id: "148264629", title: "Middle Post" }]);
    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: "Posts" })[0]).toHaveAttribute("aria-disabled", "false");
    });
  });

  it("re-enables Posts with fallback when direct-link position lookup fails", async () => {
    const neighborsDeferred = createDeferred();
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return {
          post: {
            ...buildCachedPost("Direct Link Post"),
            id: "148264629",
          },
          attachments: [],
        };
      }
      if (target.includes("/posts?")) {
        return neighborsDeferred.promise;
      }
      return [];
    });

    render(
      <PostView
        service="patreon"
        creatorId="50049787"
        creatorName="AYEH"
        postId="148264629"
        alreadySaved={false}
        creatorPosition={0}
        hasExplicitCreatorPosition={false}
        activeFilter=""
        readerSettingsOpen={false}
        onCloseReaderSettings={noop}
        onBack={noop}
        onNavigate={noop}
        onResolvePostTitle={noop}
        onResolveCreatorPosition={noop}
      />,
    );

    await screen.findByText("Direct Link Post");
    const postsButtons = screen.getAllByRole("link", { name: "Posts" });
    expect(postsButtons[0]).toHaveAttribute("aria-disabled", "true");

    neighborsDeferred.resolve([]);
    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: "Posts" })[0]).toHaveAttribute("aria-disabled", "false");
    });
  });
});
