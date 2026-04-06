import React from "react";
import { render, screen } from "@testing-library/react";

vi.mock("./components/Home.jsx", () => ({
  default: () => <div>Home Mock</div>,
}));

vi.mock("./components/CreatorPage.jsx", () => ({
  default: ({ service, creatorId }) => (
    <div>{`Creator Mock ${service}:${creatorId}`}</div>
  ),
}));

vi.mock("./components/PostView.jsx", () => ({
  default: ({ postId }) => <div>{`Post Mock ${postId}`}</div>,
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

describe("App integration", () => {
  beforeEach(() => {
    localStorage.clear();
    setupMatchMedia();
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
});
