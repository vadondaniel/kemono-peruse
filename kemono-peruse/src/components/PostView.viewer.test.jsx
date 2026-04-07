import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
}));

import PostView from "./PostView.jsx";
import { READER_SETTINGS_UNSAVED_KEY } from "../constants.js";

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

const buildPostPayload = ({
  id = "148264629",
  title = "Post Title",
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

describe("PostView reader and viewer behavior", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    localStorage.clear();
    setupMatchMedia();
  });

  it("closes reader settings on Escape/overlay and persists reader option changes", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return buildPostPayload({ title: "Reader Settings Post" });
      }
      if (target.includes("/posts?")) {
        return [{ id: "148264629", title: "Reader Settings Post" }];
      }
      return [];
    });

    const onCloseReaderSettings = vi.fn();
    const { rerender } = render(
      <PostView
        {...baseProps}
        readerSettingsOpen
        onCloseReaderSettings={onCloseReaderSettings}
      />,
    );

    await screen.findByText("Reader Settings Post");
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCloseReaderSettings).toHaveBeenCalledTimes(1);

    const overlay = document.querySelector(".reader-modal-overlay");
    expect(overlay).toBeTruthy();
    fireEvent.click(overlay);
    expect(onCloseReaderSettings).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Large" }));

    const postCard = document.querySelector(".post-card");
    expect(postCard).toHaveClass("reader-scale-large");
    expect(JSON.parse(localStorage.getItem(READER_SETTINGS_UNSAVED_KEY) || "{}").textScale).toBe("large");

    rerender(<PostView {...baseProps} readerSettingsOpen={false} />);
    await waitFor(() => {
      expect(document.body.style.overflow).toBe("");
    });
  });

  it("opens gallery viewer, toggles zoom, navigates with keyboard, and closes with Escape", async () => {
    localStorage.setItem(
      READER_SETTINGS_UNSAVED_KEY,
      JSON.stringify({
        galleryMode: "both",
        attachmentsMode: "original",
      }),
    );

    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return buildPostPayload({
          title: "Gallery Viewer Post",
          attachments: [
            { path: "/files/one.jpg", server: "https://n1.kemono.su", name: "one.jpg" },
            { path: "/files/two.png", server: "https://n1.kemono.su", name: "two.png" },
          ],
        });
      }
      if (target.includes("/posts?")) {
        return [{ id: "148264629", title: "Gallery Viewer Post" }];
      }
      return [];
    });

    render(<PostView {...baseProps} />);

    await screen.findByText("Gallery Viewer Post");
    fireEvent.click(screen.getByRole("button", { name: "Open image in viewer" }));

    await screen.findByRole("dialog", { name: "Image viewer" });
    const stage = screen.getByLabelText("Zoom in for full resolution");
    fireEvent.click(stage, { clientX: 40, clientY: 20 });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Fit to screen" })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => {
      expect(screen.getAllByText("2 / 2").length).toBeGreaterThan(0);
    });

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Image viewer" })).not.toBeInTheDocument();
    });
  });

  it("opens hero image viewer via keyboard interaction", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return buildPostPayload({
          title: "Hero Keyboard Post",
          file: { path: "/files/hero.jpg", name: "hero.jpg" },
        });
      }
      if (target.includes("/posts?")) {
        return [{ id: "148264629", title: "Hero Keyboard Post" }];
      }
      return [];
    });

    render(<PostView {...baseProps} />);

    await screen.findByText("Hero Keyboard Post");
    const hero = screen.getByLabelText("Open feature image in viewer");
    fireEvent.keyDown(hero, { key: "Enter" });

    await screen.findByRole("dialog", { name: "Image viewer" });
  });

  it("falls back to default filter fields when stored field flags are all false", async () => {
    localStorage.setItem(
      "kemono.filterFields.patreon.50049787",
      JSON.stringify({ title: false, tags: false, body: false }),
    );

    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return buildPostPayload({ title: "Field Fallback Post" });
      }
      if (target.includes("/posts?")) {
        return [];
      }
      return [];
    });

    render(
      <PostView
        {...baseProps}
        hasExplicitCreatorPosition={false}
        activeFilter="alpha,beta"
      />,
    );

    await screen.findByText("Field Fallback Post");

    await waitFor(() => {
      const postsCalls = fetchJsonMock.mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.includes("/posts?"));
      expect(postsCalls.length).toBeGreaterThan(0);
      expect(postsCalls[0]).toContain("title=false&tags=true&body=true");
      expect(postsCalls[0]).toContain("&tag=alpha");
      expect(postsCalls[0]).toContain("&tag=beta");
    });
  });

  it("does not hijack modified-click navigation for the Posts link", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return buildPostPayload({ title: "Posts Link Behavior" });
      }
      if (target.includes("/posts?")) {
        return [{ id: "148264629", title: "Posts Link Behavior" }];
      }
      return [];
    });

    const onBack = vi.fn();
    render(<PostView {...baseProps} onBack={onBack} />);

    await screen.findByText("Posts Link Behavior");
    const postsLink = screen.getAllByRole("link", { name: "Posts" })[0];

    fireEvent.click(postsLink, { ctrlKey: true });
    expect(onBack).toHaveBeenCalledTimes(0);

    fireEvent.click(postsLink);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
