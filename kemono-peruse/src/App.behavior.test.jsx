import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.fn();
const copyUnsavedCreatorSettingsToMock = vi.fn();
const copyReaderSettingsMock = vi.fn();
const resolveProfileDisplayNameMock = vi.fn((profile) => profile?.name || "");

vi.mock("./utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
}));

vi.mock("./utils/creators.js", async () => {
  const actual = await vi.importActual("./utils/creators.js");
  return {
    ...actual,
    copyUnsavedCreatorSettingsTo: (...args) => copyUnsavedCreatorSettingsToMock(...args),
    resolveProfileDisplayName: (...args) => resolveProfileDisplayNameMock(...args),
  };
});

vi.mock("./utils/preferences.js", async () => {
  const actual = await vi.importActual("./utils/preferences.js");
  return {
    ...actual,
    copyReaderSettings: (...args) => copyReaderSettingsMock(...args),
  };
});

vi.mock("./components/Home.jsx", () => ({
  default: ({ onSaveCreator }) => (
    <div>
      <div>Home Mock</div>
      <button
        type="button"
        onClick={() => onSaveCreator?.({ service: "patreon", id: "50049787", name: "50049787" })}
      >
        Save API Creator
      </button>
    </div>
  ),
}));

vi.mock("./components/CreatorPage.jsx", () => ({
  default: ({ service, creatorId }) => <div>{`Creator Mock ${service}:${creatorId}`}</div>,
}));

vi.mock("./components/PostView.jsx", () => ({
  default: ({ postId }) => <div>{`Post Mock ${postId}`}</div>,
}));

import App from "./App.jsx";

const setupMatchMedia = ({ legacy = false, matches = false } = {}) => {
  const listeners = new Set();
  const media = {
    matches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    dispatchEvent: vi.fn(),
  };
  if (legacy) {
    media.addListener = vi.fn((handler) => listeners.add(handler));
    media.removeListener = vi.fn((handler) => listeners.delete(handler));
    media.addEventListener = undefined;
    media.removeEventListener = undefined;
  } else {
    media.addEventListener = vi.fn((eventName, handler) => {
      if (eventName === "change") listeners.add(handler);
    });
    media.removeEventListener = vi.fn((eventName, handler) => {
      if (eventName === "change") listeners.delete(handler);
    });
    media.addListener = vi.fn((handler) => listeners.add(handler));
    media.removeListener = vi.fn((handler) => listeners.delete(handler));
  }

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => media),
  });

  return { media, listeners };
};

describe("App behavior coverage", () => {
  beforeEach(() => {
    localStorage.clear();
    setupMatchMedia();
    fetchJsonMock.mockReset();
    copyUnsavedCreatorSettingsToMock.mockReset();
    copyReaderSettingsMock.mockReset();
    resolveProfileDisplayNameMock.mockClear();
    window.history.replaceState(null, "", "/");
  });

  it("falls back to safe defaults when persisted JSON is invalid", async () => {
    localStorage.setItem("kemono.savedCreators", "{broken-json");
    localStorage.setItem("kemono.creatorFilters", "{broken-json");
    localStorage.setItem("kemono.creatorPositions", "{broken-json");

    const { unmount } = render(<App />);
    await screen.findByText("Home Mock");

    unmount();

    expect(localStorage.getItem("kemono.savedCreators")).toBe("[]");
    expect(localStorage.getItem("kemono.creatorFilters")).toBe("{}");
    expect(localStorage.getItem("kemono.creatorPositions")).toBe("{}");
  });

  it("keeps modified brand-link clicks from triggering in-app navigation", async () => {
    render(<App />);
    await screen.findByText("Home Mock");

    act(() => {
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
    });
    await screen.findByText("Creator Mock patreon:50049787");

    const brandLink = screen.getByRole("link", { name: "Kemono Peruse" });
    const brandHref = brandLink.getAttribute("href");
    act(() => {
      brandLink.removeAttribute("href");
      fireEvent.click(brandLink, { ctrlKey: true });
      brandLink.setAttribute("href", brandHref);
    });
    expect(screen.getByText("Creator Mock patreon:50049787")).toBeInTheDocument();

    fireEvent.click(brandLink);
    await screen.findByText("Home Mock");
  });

  it("saves a creator with API-resolved name and skips duplicate saves", async () => {
    fetchJsonMock.mockResolvedValue({ name: "Resolved AYEH" });
    resolveProfileDisplayNameMock.mockReturnValue("Resolved AYEH");

    const { unmount } = render(<App />);
    await screen.findByText("Home Mock");

    const saveButton = screen.getByRole("button", { name: "Save API Creator" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledTimes(1);
      expect(copyUnsavedCreatorSettingsToMock).toHaveBeenCalledTimes(1);
      expect(copyReaderSettingsMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledTimes(1);
      expect(copyUnsavedCreatorSettingsToMock).toHaveBeenCalledTimes(1);
      expect(copyReaderSettingsMock).toHaveBeenCalledTimes(1);
    });

    unmount();

    expect(JSON.parse(localStorage.getItem("kemono.savedCreators") || "[]")).toEqual([
      { service: "patreon", id: "50049787", name: "Resolved AYEH" },
    ]);
  });

  it("uses legacy matchMedia listener APIs and persists theme changes", async () => {
    const { media } = setupMatchMedia({ legacy: true, matches: false });

    const { unmount } = render(<App />);
    await screen.findByText("Home Mock");

    expect(media.addListener).toHaveBeenCalledTimes(1);

    const themeSelect = screen.getByLabelText("Theme");
    fireEvent.change(themeSelect, { target: { value: "dark" } });

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("kemono.theme")).toBe("dark");

    unmount();
    expect(media.removeListener).toHaveBeenCalledTimes(1);
  });
});
