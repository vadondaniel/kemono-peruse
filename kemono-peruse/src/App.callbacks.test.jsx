import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.fn();
const purgeCreatorLocalStateMock = vi.fn();
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
    purgeCreatorLocalState: (...args) => purgeCreatorLocalStateMock(...args),
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
  default: ({ savedCreators, onSaveCreator, onRenameCreator, onRemoveCreator, onOpenCreator }) => (
    <div>
      <div>Home Mock</div>
      <div>{`Saved Count ${savedCreators.length}`}</div>
      <button type="button" onClick={() => onSaveCreator?.({ service: "patreon", id: "50049787", name: "AYEH" })}>
        Save Home Creator
      </button>
      <button
        type="button"
        onClick={() => onRenameCreator?.({ service: "patreon", id: "50049787", name: "  Renamed AYEH  " })}
      >
        Rename Home Creator
      </button>
      <button type="button" onClick={() => onRemoveCreator?.("patreon", "50049787")}>
        Remove Home Creator
      </button>
      <button type="button" onClick={() => onOpenCreator?.("patreon", "50049787", "AYEH")}>
        Open Creator View
      </button>
    </div>
  ),
}));

vi.mock("./components/CreatorPage.jsx", () => ({
  default: ({
    service,
    creatorId,
    creatorName,
    activeFilter,
    initialPosition,
    onOpenPost,
    onSave,
    onUpdateFilter,
    onRememberPosition,
  }) => (
    <div>
      <div>{`Creator Mock ${service}:${creatorId}`}</div>
      <div>{`Creator Name ${creatorName}`}</div>
      <div>{`Creator Filter ${activeFilter || "(empty)"}`}</div>
      <div>{`Creator Position ${initialPosition ?? 0}`}</div>
      <button type="button" onClick={() => onOpenPost?.("post-200", "Post 200", 149)}>
        Open Post 200
      </button>
      <button type="button" onClick={() => onSave?.()}>
        Save Current Creator
      </button>
      <button type="button" onClick={() => onUpdateFilter?.(" alpha ")}>
        Set Filter Alpha
      </button>
      <button type="button" onClick={() => onUpdateFilter?.(" ")}>
        Clear Filter
      </button>
      <button type="button" onClick={() => onRememberPosition?.(1, { pageSize: 25 })}>
        Remember Same Page
      </button>
      <button type="button" onClick={() => onRememberPosition?.(149, { pageSize: 25 })}>
        Remember Position 149
      </button>
    </div>
  ),
}));

vi.mock("./components/PostView.jsx", () => ({
  default: ({ postId, readerSettingsOpen, onCloseReaderSettings, onBack, onNavigate, onResolvePostTitle }) => (
    <div>
      <div>{`Post Mock ${postId}`}</div>
      <div>{`Reader Settings Open ${readerSettingsOpen ? "yes" : "no"}`}</div>
      <button type="button" onClick={() => onCloseReaderSettings?.()}>
        Close Reader Settings
      </button>
      <button type="button" onClick={() => onBack?.()}>
        Post Back To Creator
      </button>
      <button type="button" onClick={() => onNavigate?.("post-201")}>
        Post Next
      </button>
      <button type="button" onClick={() => onResolvePostTitle?.(123)}>
        Resolve NonString Title
      </button>
      <button type="button" onClick={() => onResolvePostTitle?.("Resolved Post Title")}>
        Resolve String Title
      </button>
    </div>
  ),
}));

import App from "./App.jsx";

const setupMatchMedia = ({ matches = false } = {}) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const dispatchPopState = (view) => {
  act(() => {
    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: { view },
      }),
    );
  });
};

const navigateToCreator = () => {
  dispatchPopState({
    name: "creator",
    service: "patreon",
    creatorId: "50049787",
    creatorName: "AYEH",
  });
};

describe("App callback and error-path coverage", () => {
  beforeEach(() => {
    localStorage.clear();
    setupMatchMedia();
    fetchJsonMock.mockReset();
    purgeCreatorLocalStateMock.mockReset();
    copyUnsavedCreatorSettingsToMock.mockReset();
    copyReaderSettingsMock.mockReset();
    resolveProfileDisplayNameMock.mockClear();
    window.history.replaceState(null, "", "/");
  });

  it("logs a warning when initial history replacement fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const replaceSpy = vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw new Error("replace fail");
    });

    try {
      render(<App />);
      await screen.findByText("Home Mock");
      expect(warnSpy).toHaveBeenCalledWith("Failed to initialize browser history", expect.any(Error));
    } finally {
      replaceSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("logs a warning when pushState fails during in-app navigation", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<App />);
    await screen.findByText("Home Mock");

    navigateToCreator();
    await screen.findByText("Creator Mock patreon:50049787");

    const pushSpy = vi.spyOn(window.history, "pushState").mockImplementation(() => {
      throw new Error("push fail");
    });

    try {
      fireEvent.click(screen.getByRole("link", { name: "Kemono Peruse" }));
      await screen.findByText("Home Mock");
      expect(warnSpy).toHaveBeenCalledWith("Failed to update browser history", expect.any(Error));
    } finally {
      pushSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("drives home/creator/post callbacks and side effects", async () => {
    setupMatchMedia({ matches: true });
    localStorage.setItem("kemono.savedCreators", JSON.stringify([{ service: "patreon", id: "50049787", name: "AYEH" }]));
    localStorage.setItem("kemono.creatorFilters", JSON.stringify({ "patreon:50049787": "seed" }));
    localStorage.setItem("kemono.creatorPositions", JSON.stringify({ "patreon:50049787": 149 }));

    const { unmount } = render(<App />);
    await screen.findByText("Home Mock");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    fireEvent.click(screen.getByRole("button", { name: "Rename Home Creator" }));
    await waitFor(() => {
      expect(screen.getByText("Saved Count 1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Creator View" }));
    await screen.findByText("Creator Mock patreon:50049787");
    expect(screen.getByText("Creator Position 0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Set Filter Alpha" }));
    await waitFor(() => {
      expect(screen.getByText("Creator Filter alpha")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear Filter" }));
    await waitFor(() => {
      expect(screen.getByText("Creator Filter (empty)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Remember Same Page" }));
    fireEvent.click(screen.getByRole("button", { name: "Remember Position 149" }));
    await waitFor(() => {
      expect(screen.getByText("Creator Position 125")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Post 200" }));
    await screen.findByText("Post Mock post-200");

    fireEvent.click(screen.getByRole("button", { name: "Reader settings" }));
    await waitFor(() => {
      expect(screen.getByText("Reader Settings Open yes")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close Reader Settings" }));
    await waitFor(() => {
      expect(screen.getByText("Reader Settings Open no")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Resolve NonString Title" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve String Title" }));
    fireEvent.click(screen.getByRole("button", { name: "Post Next" }));
    await screen.findByText("Post Mock post-201");

    fireEvent.click(screen.getByRole("button", { name: "Post Back To Creator" }));
    await screen.findByText("Creator Mock patreon:50049787");
    await screen.findByText("Creator Position 100");
    fireEvent.click(screen.getByRole("button", { name: "Save Current Creator" }));
    await screen.findByText("Creator Mock patreon:50049787");

    fireEvent.click(screen.getByRole("link", { name: "Kemono Peruse" }));
    await screen.findByText("Home Mock");
    fireEvent.click(screen.getByRole("button", { name: "Remove Home Creator" }));
    await waitFor(() => {
      expect(screen.getByText("Saved Count 0")).toBeInTheDocument();
    });
    expect(purgeCreatorLocalStateMock).toHaveBeenCalledWith("patreon", "50049787");

    unmount();
    expect(JSON.parse(localStorage.getItem("kemono.savedCreators") || "[]")).toEqual([]);
    expect(JSON.parse(localStorage.getItem("kemono.creatorFilters") || "{}")).toEqual({});
    expect(JSON.parse(localStorage.getItem("kemono.creatorPositions") || "{}")).toEqual({});
  });

  it("falls back to creator id when API name lookup fails during creator save", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchJsonMock.mockRejectedValue(new Error("profile fail"));

    const { unmount } = render(<App />);
    await screen.findByText("Home Mock");

    dispatchPopState({
      name: "creator",
      service: "patreon",
      creatorId: "50049787",
      creatorName: "50049787",
    });

    await screen.findByText("Creator Mock patreon:50049787");
    fireEvent.click(screen.getByRole("button", { name: "Save Current Creator" }));

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("Failed to resolve creator name from API", expect.any(Error));
    });

    unmount();
    expect(JSON.parse(localStorage.getItem("kemono.savedCreators") || "[]")).toEqual([
      { service: "patreon", id: "50049787", name: "50049787" },
    ]);
    warnSpy.mockRestore();
  });

  it("auto-closes reader settings when leaving post view", async () => {
    render(<App />);
    await screen.findByText("Home Mock");

    dispatchPopState({
      name: "creator",
      service: "patreon",
      creatorId: "50049787",
      creatorName: "AYEH",
    });
    await screen.findByText("Creator Mock patreon:50049787");

    fireEvent.click(screen.getByRole("button", { name: "Open Post 200" }));
    await screen.findByText("Post Mock post-200");
    fireEvent.click(screen.getByRole("button", { name: "Reader settings" }));
    await screen.findByText("Reader Settings Open yes");

    fireEvent.click(screen.getByRole("link", { name: "Kemono Peruse" }));
    await screen.findByText("Home Mock");

    dispatchPopState({
      name: "post",
      service: "patreon",
      creatorId: "50049787",
      creatorName: "AYEH",
      postId: "post-200",
    });
    await screen.findByText("Post Mock post-200");
    await screen.findByText("Reader Settings Open no");
  });
});
