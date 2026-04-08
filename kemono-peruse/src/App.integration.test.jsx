import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PAGE_SIZE_KEY } from "./constants.js";

vi.mock("./components/Home.jsx", () => ({
  default: ({ onSaveCreator, onRenameCreator }) => (
    <div>
      <div>Home Mock</div>
      <button
        type="button"
        onClick={() => onSaveCreator?.({ service: "patreon", id: "50049787", name: "AYEH" })}
      >
        Save Mock Creator
      </button>
      <button
        type="button"
        onClick={() => onRenameCreator?.({ service: "patreon", id: "50049787", name: "AYEH Renamed" })}
      >
        Rename Mock Creator
      </button>
    </div>
  ),
}));

vi.mock("./components/CreatorPage.jsx", () => ({
  default: ({ service, creatorId, initialPosition }) => (
    <div>
      <div>{`Creator Mock ${service}:${creatorId}`}</div>
      <div>{`Creator Position ${initialPosition ?? 0}`}</div>
    </div>
  ),
}));

vi.mock("./components/PostView.jsx", () => ({
  default: ({ postId, onNavigate, onBack, onResolveCreatorPosition, hasExplicitCreatorPosition }) => {
    React.useEffect(() => {
      if (typeof onResolveCreatorPosition !== "function") return;
      if (postId === "200") {
        onResolveCreatorPosition(75, { pageSize: 50 });
      }
    }, [postId, onResolveCreatorPosition]);

    return (
        <div>
          <div>{`Post Mock ${postId}`}</div>
          <div>{`Has Explicit Position ${hasExplicitCreatorPosition ? "yes" : "no"}`}</div>
        <button type="button" onClick={() => onNavigate?.("200")}>
          Mock Next
        </button>
        <button type="button" onClick={() => onBack?.()}>
          Posts
        </button>
        <button type="button" onClick={() => onResolveCreatorPosition?.(149, { pageSize: 25 })}>
          Resolve Position 149 With 25
        </button>
        <button type="button" onClick={() => onResolveCreatorPosition?.(149, { pageSize: 0 })}>
          Resolve Position 149 With Fallback Size
        </button>
        <button type="button" onClick={() => onResolveCreatorPosition?.(149, { pageSize: 25, persist: false })}>
          Resolve Position 149 Without Persist
        </button>
      </div>
    );
  },
}));

import App from "./App.jsx";

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

const setScrollY = (value) => {
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    writable: true,
    value,
  });
};

const setPageGeometry = ({ innerHeight = 800, scrollHeight = 2000 } = {}) => {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: innerHeight,
  });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    writable: true,
    value: scrollHeight,
  });
  Object.defineProperty(document.body, "scrollHeight", {
    configurable: true,
    writable: true,
    value: scrollHeight,
  });
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("App integration", () => {
  beforeEach(() => {
    localStorage.clear();
    setupMatchMedia();
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    setScrollY(0);
    setPageGeometry();
    window.history.replaceState(null, "", "/");
  });

  it("handles popstate by restoring the view from history state", async () => {
    render(<App />);
    await screen.findByText("Home Mock");

    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          view: {
            name: "creator",
            service: "patreon",
            creatorId: "50049787",
            creatorName: "AYEH",
          },
        },
      }),
    );

    await screen.findByText("Creator Mock patreon:50049787");
    expect(document.title).toContain("AYEH");
  });

  it("flushes debounced storage writes when unmounted", async () => {
    const { unmount } = render(<App />);
    await screen.findByText("Home Mock");

    expect(localStorage.getItem("kemono.savedCreators")).toBeNull();

    unmount();

    expect(localStorage.getItem("kemono.savedCreators")).toBe("[]");
  });

  it("does not render back-to-top on home view", async () => {
    render(<App />);
    await screen.findByText("Home Mock");

    expect(screen.queryByRole("button", { name: "Back to top" })).not.toBeInTheDocument();
  });

  it("shows back-to-top while scrolling in post view and hides it after a delay", async () => {
    render(<App />);
    await screen.findByText("Home Mock");

    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          view: {
            name: "post",
            service: "patreon",
            creatorId: "50049787",
            creatorName: "AYEH",
            postId: "123",
          },
        },
      }),
    );

    await screen.findByText("Post Mock 123");
    expect(screen.queryByRole("button", { name: "Back to top" })).not.toBeInTheDocument();

    setScrollY(350);
    window.dispatchEvent(new Event("scroll"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Back to top" })).toBeInTheDocument();
    });

    await wait(1500);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Back to top" })).not.toBeInTheDocument();
    });
  });

  it("keeps back-to-top visible at the bottom of long pages even after scrolling stops", async () => {
    render(<App />);
    await screen.findByText("Home Mock");

    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          view: {
            name: "post",
            service: "patreon",
            creatorId: "50049787",
            creatorName: "AYEH",
            postId: "123",
          },
        },
      }),
    );

    await screen.findByText("Post Mock 123");
    setScrollY(1200);
    window.dispatchEvent(new Event("scroll"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Back to top" })).toBeInTheDocument();
    });

    await wait(1200);

    expect(screen.getByRole("button", { name: "Back to top" })).toBeInTheDocument();
  });

  it("does not show back-to-top for short pages, even at the bottom", async () => {
    setPageGeometry({ innerHeight: 800, scrollHeight: 700 });
    render(<App />);
    await screen.findByText("Home Mock");

    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          view: {
            name: "post",
            service: "patreon",
            creatorId: "50049787",
            creatorName: "AYEH",
            postId: "123",
          },
        },
      }),
    );

    await screen.findByText("Post Mock 123");
    window.dispatchEvent(new Event("scroll"));

    expect(screen.queryByRole("button", { name: "Back to top" })).not.toBeInTheDocument();
  });

  it("does not hide back-to-top while hovered and restarts hide delay after hover leaves", async () => {
    render(<App />);
    await screen.findByText("Home Mock");

    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          view: {
            name: "post",
            service: "patreon",
            creatorId: "50049787",
            creatorName: "AYEH",
            postId: "123",
          },
        },
      }),
    );

    await screen.findByText("Post Mock 123");
    setScrollY(350);
    window.dispatchEvent(new Event("scroll"));

    const backToTopButton = await screen.findByRole("button", { name: "Back to top" });
    fireEvent.mouseEnter(backToTopButton);

    await wait(1700);
    expect(screen.getByRole("button", { name: "Back to top" })).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByRole("button", { name: "Back to top" }));
    await wait(1500);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Back to top" })).not.toBeInTheDocument();
    });
  });

  it("clicking back-to-top scrolls smoothly to the top", async () => {
    render(<App />);
    await screen.findByText("Home Mock");

    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          view: {
            name: "post",
            service: "patreon",
            creatorId: "50049787",
            creatorName: "AYEH",
            postId: "123",
          },
        },
      }),
    );

    await screen.findByText("Post Mock 123");
    setScrollY(350);
    window.dispatchEvent(new Event("scroll"));

    const backToTopButton = await screen.findByRole("button", { name: "Back to top" });
    fireEvent.click(backToTopButton);

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("returns to the page containing the current unfiltered post after navigating within post view", async () => {
    render(<App />);
    await screen.findByText("Home Mock");

    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          view: {
            name: "post",
            service: "patreon",
            creatorId: "50049787",
            creatorName: "AYEH",
            postId: "123",
          },
        },
      }),
    );

    await screen.findByText("Post Mock 123");
    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          view: {
            name: "post",
            service: "patreon",
            creatorId: "50049787",
            creatorName: "AYEH",
            postId: "200",
          },
        },
      }),
    );
    await screen.findByText("Post Mock 200");
    await screen.findByText("Has Explicit Position yes");

    fireEvent.click(screen.getByRole("button", { name: "Posts" }));

    await screen.findByText("Creator Mock patreon:50049787");
    expect(screen.getByText("Creator Position 50")).toBeInTheDocument();
  });

  it("returns to the page containing the current filtered post after navigating within post view", async () => {
    localStorage.setItem("kemono.creatorFilters", JSON.stringify({ "patreon:50049787": "alpha" }));
    render(<App />);
    await screen.findByText("Home Mock");

    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          view: {
            name: "post",
            service: "patreon",
            creatorId: "50049787",
            creatorName: "AYEH",
            postId: "123",
          },
        },
      }),
    );

    await screen.findByText("Post Mock 123");
    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          view: {
            name: "post",
            service: "patreon",
            creatorId: "50049787",
            creatorName: "AYEH",
            postId: "200",
          },
        },
      }),
    );
    await screen.findByText("Post Mock 200");
    await screen.findByText("Has Explicit Position yes");

    fireEvent.click(screen.getByRole("button", { name: "Posts" }));

    await screen.findByText("Creator Mock patreon:50049787");
    expect(screen.getByText("Creator Position 50")).toBeInTheDocument();
  });

  it("keeps explicit first-page position as 0 for post and creator history state", async () => {
    localStorage.setItem("kemono.creatorPositions", JSON.stringify({ "patreon:50049787": 75 }));
    render(<App />);
    await screen.findByText("Home Mock");

    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          view: {
            name: "creator",
            service: "patreon",
            creatorId: "50049787",
            creatorName: "AYEH",
            position: 0,
          },
        },
      }),
    );

    await screen.findByText("Creator Mock patreon:50049787");
    expect(screen.getByText("Creator Position 0")).toBeInTheDocument();

    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          view: {
            name: "post",
            service: "patreon",
            creatorId: "50049787",
            creatorName: "AYEH",
            postId: "123",
            position: 0,
          },
        },
      }),
    );

    await screen.findByText("Post Mock 123");
    expect(screen.getByText("Has Explicit Position yes")).toBeInTheDocument();
  });

  it("marks direct-link posts without pos as unresolved explicit position initially", async () => {
    render(<App />);
    await screen.findByText("Home Mock");

    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          view: {
            name: "post",
            service: "patreon",
            creatorId: "50049787",
            creatorName: "AYEH",
            postId: "404",
          },
        },
      }),
    );

    await screen.findByText("Post Mock 404");
    expect(screen.getByText("Has Explicit Position no")).toBeInTheDocument();
  });

  it("removes pos query from post url while preserving resolved history state", async () => {
    window.history.replaceState(
      null,
      "",
      "/creator/patreon/50049787/post/123?pos=75",
    );

    render(<App />);

    await screen.findByText("Post Mock 123");
    await waitFor(() => {
      expect(window.location.pathname).toBe("/creator/patreon/50049787/post/123");
      expect(window.location.search).toBe("");
    });
  });

  it("uses stored page size when resolved creator position has invalid pageSize override", async () => {
    localStorage.setItem(PAGE_SIZE_KEY, "75");
    render(<App />);
    await screen.findByText("Home Mock");

    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          view: {
            name: "post",
            service: "patreon",
            creatorId: "50049787",
            creatorName: "AYEH",
            postId: "123",
          },
        },
      }),
    );

    await screen.findByText("Post Mock 123");
    fireEvent.click(screen.getByRole("button", { name: "Resolve Position 149 With Fallback Size" }));
    fireEvent.click(screen.getByRole("button", { name: "Posts" }));

    await screen.findByText("Creator Mock patreon:50049787");
    expect(screen.getByText("Creator Position 75")).toBeInTheDocument();
  });

  it("syncs creator view position but does not persist creatorPositions when persist=false", async () => {
    localStorage.setItem("kemono.creatorPositions", JSON.stringify({ "patreon:50049787": 20 }));

    const { unmount } = render(<App />);
    await screen.findByText("Home Mock");

    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: {
          view: {
            name: "post",
            service: "patreon",
            creatorId: "50049787",
            creatorName: "AYEH",
            postId: "123",
          },
        },
      }),
    );

    await screen.findByText("Post Mock 123");
    fireEvent.click(screen.getByRole("button", { name: "Resolve Position 149 Without Persist" }));
    fireEvent.click(screen.getByRole("button", { name: "Posts" }));

    await screen.findByText("Creator Mock patreon:50049787");
    expect(screen.getByText("Creator Position 125")).toBeInTheDocument();

    unmount();
    expect(localStorage.getItem("kemono.creatorPositions")).toBe(
      JSON.stringify({ "patreon:50049787": 20 }),
    );
  });

  it("coalesces debounced creator position writes and persists only the latest position", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    try {
      render(<App />);
      await screen.findByText("Home Mock");
      await new Promise((resolve) => setTimeout(resolve, 300));
      setItemSpy.mockClear();

      window.dispatchEvent(
        new PopStateEvent("popstate", {
          state: {
            view: {
              name: "post",
              service: "patreon",
              creatorId: "50049787",
              creatorName: "AYEH",
              postId: "123",
            },
          },
        }),
      );

      await screen.findByText("Post Mock 123");
      fireEvent.click(screen.getByRole("button", { name: "Resolve Position 149 With 25" }));
      fireEvent.click(screen.getByRole("button", { name: "Resolve Position 149 With Fallback Size" }));

      let creatorPositionWrites = setItemSpy.mock.calls.filter(
        ([key]) => key === "kemono.creatorPositions",
      );
      expect(creatorPositionWrites).toHaveLength(0);

      await new Promise((resolve) => setTimeout(resolve, 300));

      creatorPositionWrites = setItemSpy.mock.calls.filter(
        ([key]) => key === "kemono.creatorPositions",
      );
      expect(creatorPositionWrites).toHaveLength(1);
      expect(creatorPositionWrites[0][1]).toBe(JSON.stringify({ "patreon:50049787": 149 }));
    } finally {
      setItemSpy.mockRestore();
    }
  });
});
