import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
}));

import Home from "./Home.jsx";

const noop = () => {};

class FakeWorker {
  static instances = [];

  constructor() {
    this.messages = [];
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    FakeWorker.instances.push(this);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }
}

describe("Home edge-case coverage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    FakeWorker.instances = [];
    global.Worker = undefined;
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => {};
    }
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits quick-add form via Enter and focuses creator ID when the ID is missing", async () => {
    const onOpenCreator = vi.fn();

    render(
      <Home
        savedCreators={[]}
        onSaveCreator={noop}
        onRenameCreator={noop}
        onRemoveCreator={noop}
        onOpenCreator={onOpenCreator}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add a creator" }));

    const creatorIdInput = screen.getByLabelText("Creator ID");
    const quickAddForm = creatorIdInput.closest("form");
    expect(quickAddForm).toBeTruthy();

    fireEvent.submit(quickAddForm);
    expect(onOpenCreator).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(creatorIdInput);

    fireEvent.change(creatorIdInput, { target: { value: " 789 " } });
    fireEvent.change(screen.getByLabelText("Display name (optional)"), {
      target: { value: "  Test Name  " },
    });
    fireEvent.submit(quickAddForm);

    expect(onOpenCreator).toHaveBeenCalledWith("patreon", "789", "Test Name");
  });

  it("shows min-input guidance and adds a service summary when service filter is selected", async () => {
    fetchJsonMock.mockResolvedValue([
      {
        id: "50049787",
        service: "patreon",
        name: "AYEH",
        favorited: 12,
        indexed: "2025-01-01T00:00:00.000Z",
        updated: "2025-01-02T00:00:00.000Z",
      },
      {
        id: "1234",
        service: "fanbox",
        name: "Alpha Fan",
        favorited: 7,
        indexed: "2025-01-01T00:00:00.000Z",
        updated: "2025-01-01T00:00:00.000Z",
      },
    ]);

    render(
      <Home
        savedCreators={[]}
        onSaveCreator={noop}
        onRenameCreator={noop}
        onRemoveCreator={noop}
        onOpenCreator={noop}
      />,
    );

    const searchInput = screen.getByLabelText("Search creators");
    fireEvent.change(searchInput, { target: { value: "a" } });
    await screen.findByText("Enter at least 2 characters.");

    fireEvent.change(searchInput, { target: { value: "al" } });
    await screen.findByText("Alpha Fan");

    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "fanbox" } });

    await waitFor(() => {
      expect(screen.getByText('Showing 1 for "al" · Pixiv Fanbox')).toBeInTheDocument();
    });
  });

  it("shows capped result counts when creator matches exceed the limit", async () => {
    const creators = Array.from({ length: 35 }, (_, index) => ({
      id: `id-${index + 1}`,
      service: "patreon",
      name: `zz creator ${index + 1}`,
      favorited: 0,
      indexed: "2025-01-01T00:00:00.000Z",
      updated: "2025-01-01T00:00:00.000Z",
    }));
    fetchJsonMock.mockResolvedValue(creators);

    render(
      <Home
        savedCreators={[]}
        onSaveCreator={noop}
        onRenameCreator={noop}
        onRemoveCreator={noop}
        onOpenCreator={noop}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search creators"), { target: { value: "zz" } });

    await waitFor(() => {
      expect(screen.getByText(/Showing 30 of 35 for "zz"/)).toBeInTheDocument();
    });
    expect(document.querySelectorAll(".creator-search-item")).toHaveLength(30);
  });

  it("stops pending state when worker search errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    global.Worker = FakeWorker;
    fetchJsonMock.mockResolvedValue([
      {
        id: "50049787",
        service: "patreon",
        name: "AYEH",
        favorited: 10,
        indexed: "2025-01-01T00:00:00.000Z",
        updated: "2025-01-02T00:00:00.000Z",
      },
    ]);

    try {
      render(
        <Home
          savedCreators={[]}
          onSaveCreator={noop}
          onRenameCreator={noop}
          onRemoveCreator={noop}
          onOpenCreator={noop}
        />,
      );

      fireEvent.change(screen.getByLabelText("Search creators"), { target: { value: "ay" } });

      await waitFor(() => {
        expect(FakeWorker.instances.length).toBe(1);
      });
      await screen.findByText("Searching creators…");

      FakeWorker.instances[0].onerror?.(new Error("worker exploded"));

      await screen.findByText('No matches for "ay".');
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("clears saved search and opens creators from the avatar link", async () => {
    const onOpenCreator = vi.fn();

    render(
      <Home
        savedCreators={[
          { service: "customsvc", id: "abc-1", name: "Custom One" },
          { service: "patreon", id: "50049787", name: "AYEH" },
        ]}
        onSaveCreator={noop}
        onRenameCreator={noop}
        onRemoveCreator={noop}
        onOpenCreator={onOpenCreator}
      />,
    );

    expect(screen.getByText("Customsvc · abc-1")).toBeInTheDocument();

    const savedSearchInput = screen.getByPlaceholderText("Search saved creators");
    fireEvent.change(savedSearchInput, { target: { value: "zz-not-found" } });
    await screen.findByText("No creators match your search.");

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      expect(savedSearchInput).toHaveValue("");
    });

    fireEvent.click(screen.getByRole("link", { name: "Open Custom One" }));
    expect(onOpenCreator).toHaveBeenCalledWith("customsvc", "abc-1", "Custom One");
  });
});
