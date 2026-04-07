import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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

describe("PostView edge-case coverage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    localStorage.clear();
    setupMatchMedia();
    writeCreatorCache("patreon", "50049787", null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes cached post without attachments and accepts root-shape payloads", async () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000_000);
    localStorage.setItem("kemono.cache.pref.patreon.50049787", "true");
    writeCreatorCache("patreon", "50049787", {
      updatedAt: 1,
      postDetails: {
        "148264629": {
          data: {
            id: "148264629",
            title: "Cached Rootless Post",
            published: "2025-01-01T00:00:00.000Z",
            content: "<p>Cached body</p>",
          },
          updatedAt: 1,
          hydrated: true,
        },
      },
    });

    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return {
          id: "148264629",
          title: "Root Payload Post",
          published: "2025-01-01T10:30:00.000Z",
          content: "<p>Body</p>",
          attachments: [{ mime: "image/png", url: "https://example.com/fresh.png", name: "fresh.png" }],
        };
      }
      if (target.includes("/posts?")) return [];
      return [];
    });

    render(<PostView {...baseProps} alreadySaved />);

    await screen.findByText("Cached Rootless Post");
    await screen.findByText("Root Payload Post");

    const toggle = screen.getByRole("button", { name: /show attachments/i });
    expect(toggle.querySelector(".attachment-count")).toHaveTextContent("1");
  });

  it("keeps stale cached detail when detail request throws", async () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000_000);
    localStorage.setItem("kemono.cache.pref.patreon.50049787", "true");
    writeCreatorCache("patreon", "50049787", {
      updatedAt: 1,
      postDetails: {
        "148264629": {
          data: {
            id: "148264629",
            title: "Cached Fallback Post",
            published: "2025-01-01T00:00:00.000Z",
            content: "<p>Cached body</p>",
          },
          updatedAt: 1,
          hydrated: true,
        },
      },
    });

    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        throw new Error("detail fetch failure");
      }
      if (target.includes("/posts?")) return [];
      return [];
    });

    render(<PostView {...baseProps} alreadySaved />);

    await screen.findByText("Cached Fallback Post");
    await screen.findByText("Using stale archive copy (offline or source unavailable).");
  });

  it("uses profile fallback when creator name is missing", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return {
          post: {
            id: "148264629",
            title: "Name Fallback Post",
            published: "2025-01-01T00:00:00.000Z",
            content: "<p>Body</p>",
            attachments: [],
          },
          attachments: [],
        };
      }
      if (target.includes("/profile")) {
        return { name: "Profile Resolved Name" };
      }
      if (target.includes("/posts?")) return [];
      return [];
    });

    render(
      <PostView
        {...baseProps}
        creatorName=""
      />,
    );

    await screen.findByText("Name Fallback Post");
    await waitFor(() => {
      expect(screen.getByText("Profile Resolved Name (Patreon)")).toBeInTheDocument();
    });
  });

  it("uses cached creator name when no incoming name is provided", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return {
          post: {
            id: "148264629",
            title: "Name Source Priority",
            published: "2025-01-01T00:00:00.000Z",
            content: "<p>Body</p>",
            attachments: [],
          },
          attachments: [],
        };
      }
      if (target.includes("/posts?")) return [];
      return [];
    });

    localStorage.setItem(
      "kemono.creatorNameCache",
      JSON.stringify({ "patreon:50049787": "Cached Local Name" }),
    );

    render(<PostView {...baseProps} creatorName=" " />);
    await screen.findByText("Name Source Priority");
    await waitFor(() => {
      expect(screen.getByText("Cached Local Name (Patreon)")).toBeInTheDocument();
    });
  });

  it("prefers saved creator name over incoming creator name", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return {
          post: {
            id: "148264629",
            title: "Saved Name Preference",
            published: "2025-01-01T00:00:00.000Z",
            content: "<p>Body</p>",
            attachments: [],
          },
          attachments: [],
        };
      }
      if (target.includes("/posts?")) return [];
      return [];
    });

    localStorage.setItem(
      "kemono.savedCreators",
      JSON.stringify([{ service: "patreon", id: "50049787", name: "Saved Preferred Name" }]),
    );

    render(<PostView {...baseProps} creatorName="Incoming Name Updated" />);
    await screen.findByText("Saved Name Preference");
    await waitFor(() => {
      expect(screen.getByText("Saved Preferred Name (Patreon)")).toBeInTheDocument();
    });
  });

  it("keeps unsupported and malformed inline links untouched", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return {
          post: {
            id: "148264629",
            title: "Malformed Inline Links",
            published: "2025-01-01T00:00:00.000Z",
            content: '<p><a href="https://www.patreon.com/posts/">Patreon No Id</a></p>',
            attachments: [],
          },
          attachments: [],
        };
      }
      if (target.includes("/posts?")) return [];
      return [];
    });

    render(<PostView {...baseProps} />);
    await screen.findByText("Malformed Inline Links");

    const noId = await screen.findByRole("link", { name: "Patreon No Id" });
    expect(noId).not.toHaveAttribute("data-inline-post-link");
  });

  it("handles ArrowLeft gallery navigation", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return {
          post: {
            id: "148264629",
            title: "Arrow Left Post",
            published: "2025-01-01T00:00:00.000Z",
            content: "<p>Body</p>",
            attachments: [
              { path: "/files/one.jpg", server: "https://n1.kemono.su", name: "one.jpg" },
              { path: "/files/two.jpg", server: "https://n1.kemono.su", name: "two.jpg" },
            ],
          },
          attachments: [],
        };
      }
      if (target.includes("/posts?")) return [];
      return [];
    });

    localStorage.setItem(
      "kemono.readerSettings.unsaved",
      JSON.stringify({ galleryMode: "both", attachmentsMode: "original" }),
    );

    render(<PostView {...baseProps} />);
    await screen.findByText("Arrow Left Post");

    fireEvent.click(screen.getByRole("button", { name: "Open image in viewer" }));
    await screen.findByRole("dialog", { name: "Image viewer" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => {
      expect(screen.getAllByText("2 / 2").length).toBeGreaterThan(0);
    });

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await waitFor(() => {
      expect(screen.getAllByText("1 / 2").length).toBeGreaterThan(0);
    });
  });

  it("marks hero image loaded on image load", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/post/148264629")) {
        return {
          post: {
            id: "148264629",
            title: "Hero Load Post",
            published: "2025-01-01T00:00:00.000Z",
            content: "<p>Body</p>",
            attachments: [],
            file: { path: "/files/hero.jpg", name: "hero.jpg" },
          },
          attachments: [],
        };
      }
      if (target.includes("/posts?")) return [];
      return [];
    });

    render(<PostView {...baseProps} />);
    await screen.findByText("Hero Load Post");

    const heroImage = document.querySelector(".feature-image img");
    fireEvent.load(heroImage);
    await waitFor(() => {
      expect(heroImage).toHaveClass("image-loaded");
    });
  });
});
