import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
}));

import PostView from "./PostView.jsx";
import { API_PAGE_SIZE } from "../constants.js";

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

const baseProps = {
  service: "patreon",
  creatorId: "50049787",
  creatorName: "AYEH",
  postId: "target-post",
  alreadySaved: false,
  creatorPosition: 0,
  hasExplicitCreatorPosition: false,
  activeFilter: "",
  readerSettingsOpen: false,
  onCloseReaderSettings: noop,
  onBack: noop,
  onNavigate: noop,
  onResolvePostTitle: noop,
  onResolveCreatorPosition: noop,
};

const buildDetailPayload = ({
  id = "target-post",
  title = "Target Post",
  content = "<p>Body</p>",
  attachments = [],
  file = null,
} = {}) => ({
  post: {
    id,
    title,
    published: "2025-01-01T10:30:00.000Z",
    content,
    attachments,
    file,
  },
  attachments: [],
});

const createRangePosts = (start, count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `post-${start + index}`,
    title: `post ${start + index}`,
  }));

describe("PostView deep behavior coverage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    localStorage.clear();
    setupMatchMedia();
  });

  it("rewrites fanbox links via attachment-label fallback and reacts to DOM mutations", async () => {
    const originalDecode = HTMLImageElement.prototype.decode;
    const decodeMock = vi.fn().mockRejectedValue(new Error("decode failed"));
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      writable: true,
      value: decodeMock,
    });

    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/target-post")) {
        return buildDetailPayload({
          id: "target-post",
          title: "Fanbox Mutation Post",
          content: [
            '<p><a id="post-link" href="https://creator.fanbox.cc/posts/123456">Post jump</a></p>',
            '<p><a id="download-link" href="https://creator.fanbox.cc/files/mismatch.bin">special-file</a></p>',
            '<p><img id="inline-img" src="https://example.com/start.jpg" /></p>',
          ].join(""),
          attachments: [
            {
              path: "files/resolved.png",
              server: "https://cdn.fanbox.cc",
              name: "resolved.png",
              stem: "special-file",
            },
          ],
        });
      }
      if (target.includes("/posts?")) {
        return [{ id: "target-post", title: "Fanbox Mutation Post" }];
      }
      return [];
    });

    try {
      render(
        <PostView
          {...baseProps}
          service="fanbox"
          creatorId="9001"
          creatorName="Fanbox Creator"
        />,
      );

      await screen.findByText("Fanbox Mutation Post");

      const postLink = await screen.findByRole("link", { name: "Post jump" });
      const downloadLink = await screen.findByRole("link", { name: "special-file" });
      await waitFor(() => {
        expect(document.querySelector(".prose img")).toBeTruthy();
      });
      const inlineImage = document.querySelector(".prose img");

      expect(postLink).toHaveAttribute("data-inline-post-link", "true");
      expect(postLink.getAttribute("href")).toContain("/creator/fanbox/9001/post/123456");
      expect(downloadLink).toHaveAttribute("href", "https://cdn.fanbox.cc/files/resolved.png");
      expect(downloadLink).toHaveAttribute("data-inline-post-link", "true");

      const wrapper = inlineImage.closest(".inline-image-wrapper");
      expect(wrapper).toBeTruthy();
      expect(wrapper.querySelector(".image-placeholder")).toBeTruthy();

      await waitFor(() => {
        expect(wrapper).toHaveClass("inline-image-loaded");
        expect(inlineImage.dataset.inlinePlaceholderSig).toBeTruthy();
      });

      const previousSig = inlineImage.dataset.inlinePlaceholderSig;
      inlineImage.setAttribute("src", "https://example.com/next.jpg");
      await waitFor(() => {
        expect(inlineImage.dataset.inlinePlaceholderSig).not.toBe(previousSig);
      });

      postLink.setAttribute("href", "https://example.com/not-inline");
      await waitFor(() => {
        expect(postLink).not.toHaveAttribute("data-inline-post-link");
      });

      const removedImage = inlineImage;
      wrapper.remove();
      await waitFor(() => {
        expect(removedImage.dataset.inlinePlaceholderSig).toBeUndefined();
      });
    } finally {
      if (originalDecode) {
        Object.defineProperty(HTMLImageElement.prototype, "decode", {
          configurable: true,
          writable: true,
          value: originalDecode,
        });
      } else {
        delete HTMLImageElement.prototype.decode;
      }
    }
  });

  it("resolves neighbors when target appears in a later chunk", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/target-post")) {
        return buildDetailPayload({ id: "target-post", title: "Chunked Target" });
      }
      if (target.includes("/posts?")) {
        const parsed = new URL(target, "https://example.invalid");
        const offset = Number(parsed.searchParams.get("o") || 0);
        if (offset === 0) {
          return createRangePosts(1, API_PAGE_SIZE);
        }
        if (offset === API_PAGE_SIZE) {
          return [
            { id: "chunk-newer", title: "chunk newer" },
            { id: "target-post", title: "target post" },
            { id: "chunk-older", title: "chunk older" },
          ];
        }
        return [];
      }
      return [];
    });

    const onNavigate = vi.fn();
    const onResolveCreatorPosition = vi.fn();

    render(
      <PostView
        {...baseProps}
        onNavigate={onNavigate}
        onResolveCreatorPosition={onResolveCreatorPosition}
      />,
    );

    await screen.findByText("Chunked Target");
    await waitFor(() => {
      expect(onResolveCreatorPosition).toHaveBeenCalledWith(API_PAGE_SIZE + 1, { pageSize: API_PAGE_SIZE });
    });

    const prevButton = screen.getAllByRole("link", { name: /prev/i })[0];
    const nextButton = screen.getAllByRole("link", { name: /next/i })[0];
    fireEvent.click(prevButton);
    fireEvent.click(nextButton);

    expect(onNavigate).toHaveBeenNthCalledWith(1, "chunk-older");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "chunk-newer");
    expect(fetchJsonMock.mock.calls.some((call) => /[?&]o=50/.test(String(call[0])))).toBe(true);
  });

  it("fetches the next chunk when target is at the end of a page", async () => {
    const firstChunk = createRangePosts(1, API_PAGE_SIZE);
    firstChunk[API_PAGE_SIZE - 2] = { id: "chunk-newer-tail", title: "chunk newer tail" };
    firstChunk[API_PAGE_SIZE - 1] = { id: "target-post", title: "target post" };

    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/target-post")) {
        return buildDetailPayload({ id: "target-post", title: "Chunk End Target" });
      }
      if (target.includes("/posts?")) {
        const parsed = new URL(target, "https://example.invalid");
        const offset = Number(parsed.searchParams.get("o") || 0);
        if (offset === 0) return firstChunk;
        if (offset === API_PAGE_SIZE) return [{ id: "chunk-older-head", title: "chunk older head" }];
        return [];
      }
      return [];
    });

    const onNavigate = vi.fn();

    render(<PostView {...baseProps} onNavigate={onNavigate} hasExplicitCreatorPosition />);

    await screen.findByText("Chunk End Target");

    const prevButton = screen.getAllByRole("link", { name: /prev/i })[0];
    const nextButton = screen.getAllByRole("link", { name: /next/i })[0];
    fireEvent.click(prevButton);
    fireEvent.click(nextButton);

    expect(onNavigate).toHaveBeenNthCalledWith(1, "chunk-older-head");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "chunk-newer-tail");
    expect(fetchJsonMock.mock.calls.some((call) => /[?&]o=50/.test(String(call[0])))).toBe(true);
  });

  it("re-enables Posts and keeps fallback state when neighbor resolution throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/target-post")) {
        return buildDetailPayload({ id: "target-post", title: "Neighbor Error Target" });
      }
      if (target.includes("/posts?")) {
        throw new Error("boom");
      }
      return [];
    });

    try {
      const onBack = vi.fn();
      render(<PostView {...baseProps} onBack={onBack} />);

      await screen.findByText("Neighbor Error Target");
      await waitFor(() => {
        expect(screen.getAllByRole("link", { name: "Posts" })[0]).toHaveAttribute("aria-disabled", "false");
      });

      fireEvent.click(screen.getAllByRole("link", { name: "Posts" })[0]);
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("renders not-found state when post detail is null or request fails", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/target-post")) {
        return null;
      }
      if (target.includes("/posts?")) {
        return [];
      }
      return [];
    });

    const { rerender } = render(<PostView {...baseProps} />);
    await screen.findByText("This post could not be loaded.");

    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/target-post")) {
        throw new Error("fetch failed");
      }
      if (target.includes("/posts?")) {
        return [];
      }
      return [];
    });

    rerender(
      <PostView
        {...baseProps}
        postId="target-post-error"
      />,
    );
    await screen.findByText("This post could not be loaded.");
  });
});
