import React from "react";
import { createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const fetchJsonMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
}));

import Home from "./Home.jsx";

const noop = () => {};

describe("Home interactions", () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => {};
    }
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    fetchJsonMock.mockReset();
    global.Worker = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("supports quick-add flow and opens creator inline", async () => {
    const onSaveCreator = vi.fn();
    const onOpenCreator = vi.fn();
    render(
      <Home
        savedCreators={[]}
        onSaveCreator={onSaveCreator}
        onRenameCreator={noop}
        onRemoveCreator={noop}
        onOpenCreator={onOpenCreator}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add a creator" }));

    fireEvent.click(screen.getByRole("button", { name: "Pixiv Fanbox" }));
    fireEvent.change(screen.getByLabelText("Creator ID"), { target: { value: "1234" } });
    fireEvent.change(screen.getByLabelText("Display name (optional)"), { target: { value: "Alpha Name" } });

    fireEvent.click(screen.getByRole("link", { name: "View creator" }));
    fireEvent.click(screen.getByRole("button", { name: "Save to list" }));

    expect(onSaveCreator).toHaveBeenCalledWith({
      service: "fanbox",
      id: "1234",
      name: "Alpha Name",
    });
    expect(onOpenCreator).toHaveBeenCalledWith("fanbox", "1234", "Alpha Name");
  });

  it("passes through modified clicks and only intercepts plain creator link clicks", async () => {
    const onOpenCreator = vi.fn();

    render(
      <Home
        savedCreators={[{ service: "patreon", id: "50049787", name: "AYEH" }]}
        onSaveCreator={noop}
        onRenameCreator={noop}
        onRemoveCreator={noop}
        onOpenCreator={onOpenCreator}
      />,
    );

    const creatorLink = screen.getByRole("link", { name: "AYEH" });

    const ctrlClick = createEvent.click(creatorLink, { ctrlKey: true, button: 0 });
    fireEvent(creatorLink, ctrlClick);
    expect(ctrlClick.defaultPrevented).toBe(false);
    expect(onOpenCreator).not.toHaveBeenCalled();

    const plainClick = createEvent.click(creatorLink, { button: 0 });
    fireEvent(creatorLink, plainClick);
    expect(plainClick.defaultPrevented).toBe(true);
    expect(onOpenCreator).toHaveBeenCalledWith("patreon", "50049787", "AYEH");
  });

  it("handles saved creator rename, cancel, remove, and library search empty state", async () => {
    const onRenameCreator = vi.fn();
    const onRemoveCreator = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm");

    render(
      <Home
        savedCreators={[
          { service: "patreon", id: "50049787", name: "AYEH" },
          { service: "fanbox", id: "1234", name: "Alpha Artist" },
        ]}
        onSaveCreator={noop}
        onRenameCreator={onRenameCreator}
        onRemoveCreator={onRemoveCreator}
        onOpenCreator={noop}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Rename creator" })[0]);
    const renameInput = screen.getByPlaceholderText("Display name");
    fireEvent.change(renameInput, { target: { value: "Renamed AYEH" } });
    fireEvent.submit(renameInput.closest("form"));

    expect(onRenameCreator).toHaveBeenCalledWith({
      service: "patreon",
      id: "50049787",
      name: "Renamed AYEH",
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Rename creator" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    confirmSpy.mockReturnValue(false);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(onRemoveCreator).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]);
    expect(onRemoveCreator).toHaveBeenCalledWith("fanbox", "1234");

    fireEvent.change(screen.getByPlaceholderText("Search saved creators"), { target: { value: "nope" } });
    await screen.findByText("No creators match your search.");
    fireEvent.click(screen.getByRole("button", { name: "Reset search" }));
  });

  it("renders search results from creator directory and supports save/open actions", async () => {
    const onSaveCreator = vi.fn();
    const onOpenCreator = vi.fn();

    fetchJsonMock.mockResolvedValue([
      {
        id: "50049787",
        service: "patreon",
        name: "AYEH",
        favorited: 111,
        indexed: "2025-01-01T00:00:00.000Z",
        updated: "2025-01-02T00:00:00.000Z",
      },
      {
        id: "1234",
        service: "fanbox",
        name: "Alpha Artist",
        favorited: 5,
        indexed: "2025-01-01T00:00:00.000Z",
        updated: "2025-01-01T00:00:00.000Z",
      },
    ]);

    render(
      <Home
        savedCreators={[{ service: "patreon", id: "50049787", name: "AYEH" }]}
        onSaveCreator={onSaveCreator}
        onRenameCreator={noop}
        onRemoveCreator={noop}
        onOpenCreator={onOpenCreator}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search creators"), { target: { value: "al" } });
    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalled();
      expect(screen.getByText("Alpha Artist")).toBeInTheDocument();
    });

    const row = screen.getByText("Alpha Artist").closest(".creator-search-item");
    expect(row).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    fireEvent.click(within(row).getByRole("link", { name: "Open" }));

    expect(onSaveCreator).toHaveBeenCalledWith({
      service: "fanbox",
      id: "1234",
      name: "Alpha Artist",
    });
    expect(onOpenCreator).toHaveBeenCalledWith("fanbox", "1234", "Alpha Artist");
    expect(screen.getByText("5 favorites")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search creators"), { target: { value: "ay" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
      expect(screen.getByText("111 favorites")).toBeInTheDocument();
    });
  });

  it("shows directory error state and retries when Retry is clicked", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchJsonMock
      .mockResolvedValueOnce({ invalid: true })
      .mockResolvedValueOnce([
        {
          id: "50049787",
          service: "patreon",
          name: "AYEH",
          favorited: 1,
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

    fireEvent.change(screen.getByLabelText("Search creators"), { target: { value: "ay" } });
    const retryButton = await screen.findByRole("button", { name: "Retry" });

    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    fireEvent.click(retryButton);
    await screen.findByText("AYEH");

    expect(fetchJsonMock).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("focuses creator ID on invalid quick-add open and opens saved creators inline", async () => {
    const onOpenCreator = vi.fn();

    render(
      <Home
        savedCreators={[{ service: "patreon", id: "50049787", name: "AYEH" }]}
        onSaveCreator={noop}
        onRenameCreator={noop}
        onRemoveCreator={noop}
        onOpenCreator={onOpenCreator}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add a creator" }));
    fireEvent.change(screen.getByLabelText("Creator ID"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("link", { name: "View creator" }));

    const idInput = screen.getByLabelText("Creator ID");
    expect(document.activeElement).toBe(idInput);
    expect(onOpenCreator).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("link", { name: "AYEH" }));
    expect(onOpenCreator).toHaveBeenCalledWith("patreon", "50049787", "AYEH");
  });
});
