import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
}));

import PostView from "./PostView.jsx";
import { ORIGINAL_MEDIA_BASE } from "../constants.js";
import { getUrlForView } from "../utils/navigation.js";

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

const defaultProps = {
  service: "patreon",
  creatorId: "50049787",
  creatorName: "AYEH",
  postId: "148264629",
  alreadySaved: false,
  creatorPosition: 0,
  hasExplicitCreatorPosition: true,
  activeFilter: "",
  readerSettingsOpen: false,
  onCloseReaderSettings: noop,
  onBack: noop,
  onNavigate: noop,
  onResolvePostTitle: noop,
  onResolveCreatorPosition: noop,
};

const renderPostView = (props = {}) => render(<PostView {...defaultProps} {...props} />);

describe("PostView attachment and inline-link behavior", () => {
  beforeEach(() => {
    cleanup();
    fetchJsonMock.mockReset();
    localStorage.clear();
    setupMatchMedia();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes and dedupes attachment entries from post and payload extras", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return {
          post: {
            id: "148264629",
            title: "Attachment Normalize Post",
            published: "2025-01-01T10:30:00.000Z",
            content: "<p>Body</p>",
            attachments: [
              { path: "/files/a.jpg", name: "  alpha.jpg  " },
              { path: "files/b.png", server: "https://n4.kemono.su", name: "   " },
              { name: "manual.pdf", url: "https://example.com/manual.pdf" },
            ],
          },
          attachments: [
            { path: "files/a.jpg", name: "duplicate alpha" },
            { path: "files/c.png", server: "https://n4.kemono.su" },
          ],
        };
      }
      if (target.includes("/posts?")) {
        return [];
      }
      return [];
    });

    renderPostView();

    await screen.findByText("Attachment Normalize Post");

    const toggle = screen.getByRole("button", { name: /show attachments/i });
    expect(toggle.querySelector(".attachment-count")).toHaveTextContent("4");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(document.querySelectorAll(".attachments a.attachment")).toHaveLength(4);
    });

    const attachmentLinks = Array.from(document.querySelectorAll(".attachments a.attachment"));
    expect(attachmentLinks.map((link) => link.textContent.trim())).toEqual([
      "alpha.jpg",
      "b.png",
      "manual.pdf",
      "c.png",
    ]);
    expect(attachmentLinks.map((link) => link.getAttribute("href"))).toEqual([
      `${ORIGINAL_MEDIA_BASE}/files/a.jpg`,
      "https://n4.kemono.su/files/b.png",
      "https://example.com/manual.pdf",
      "https://n4.kemono.su/files/c.png",
    ]);
  });

  it("rewrites inline Patreon post links to local post routes", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return {
          post: {
            id: "148264629",
            title: "Patreon Rewrite Post",
            published: "2025-01-01T10:30:00.000Z",
            content:
              '<p><a href="https://www.patreon.com/posts/sample-title-123456">Patreon jump</a></p>',
            attachments: [],
          },
          attachments: [],
        };
      }
      if (target.includes("/posts?")) {
        return [];
      }
      return [];
    });

    renderPostView();

    await screen.findByText("Patreon Rewrite Post");
    const inlineLink = await screen.findByRole("link", { name: "Patreon jump" });
    const expectedHref = `${window.location.origin}${getUrlForView({
      name: "post",
      service: "patreon",
      creatorId: "50049787",
      postId: "123456",
    })}`;

    await waitFor(() => {
      expect(inlineLink).toHaveAttribute("href", expectedHref);
      expect(inlineLink).toHaveAttribute("data-inline-post-link", "true");
    });
  });

  it("rewrites inline Fanbox post and file links using local routes and attachment targets", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/222")) {
        return {
          post: {
            id: "222",
            title: "Fanbox Rewrite Post",
            published: "2025-01-01T10:30:00.000Z",
            content:
              '<p><a href="https://creator.fanbox.cc/posts/987654">Fanbox post link</a></p><p><a href="https://creator.fanbox.cc/files/abc/my-file.png">Fanbox download</a></p>',
            attachments: [{ path: "files/my-file.png", server: "https://cdn.fanbox.cc", name: "my-file.png" }],
          },
          attachments: [],
        };
      }
      if (target.includes("/posts?")) {
        return [];
      }
      return [];
    });

    renderPostView({
      service: "fanbox",
      creatorId: "9001",
      creatorName: "FANBOX Creator",
      postId: "222",
    });

    await screen.findByText("Fanbox Rewrite Post");

    const postLink = await screen.findByRole("link", { name: "Fanbox post link" });
    const fileLink = await screen.findByRole("link", { name: "Fanbox download" });

    const expectedPostHref = `${window.location.origin}${getUrlForView({
      name: "post",
      service: "fanbox",
      creatorId: "9001",
      postId: "987654",
    })}`;

    await waitFor(() => {
      expect(postLink).toHaveAttribute("href", expectedPostHref);
      expect(fileLink).toHaveAttribute("href", "https://cdn.fanbox.cc/files/my-file.png");
      expect(postLink).toHaveAttribute("data-inline-post-link", "true");
      expect(fileLink).toHaveAttribute("data-inline-post-link", "true");
    });
  });
});
