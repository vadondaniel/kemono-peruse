import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
}));

import Home from "./Home.jsx";

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

  emit(payload) {
    if (this.onmessage) {
      this.onmessage({ data: payload });
    }
  }
}

const noop = () => {};

describe("Home worker search integration", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    FakeWorker.instances = [];
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
      {
        id: "1234",
        service: "patreon",
        name: "Alpha",
        favorited: 2,
        indexed: "2025-01-01T00:00:00.000Z",
        updated: "2025-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("ignores stale worker responses and keeps latest query results", async () => {
    render(
      <Home
        savedCreators={[]}
        onSaveCreator={noop}
        onRenameCreator={noop}
        onRemoveCreator={noop}
        onOpenCreator={noop}
      />,
    );

    const input = screen.getByLabelText("Search creators");

    fireEvent.change(input, { target: { value: "al" } });

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalled();
      expect(FakeWorker.instances.length).toBe(1);
    });

    const worker = FakeWorker.instances[0];

    await waitFor(() => {
      const searchMessages = worker.messages.filter((message) => message.type === "search");
      expect(searchMessages.length).toBe(1);
    });

    const firstRequestId = worker.messages.find((message) => message.type === "search").requestId;

    fireEvent.change(input, { target: { value: "ay" } });

    await waitFor(() => {
      const searchMessages = worker.messages.filter((message) => message.type === "search");
      expect(searchMessages.length).toBe(2);
    });

    const searchMessages = worker.messages.filter((message) => message.type === "search");
    const secondRequestId = searchMessages[1].requestId;
    expect(secondRequestId).toBeGreaterThan(firstRequestId);

    act(() => {
      worker.emit({
        type: "searchResult",
        requestId: firstRequestId,
        total: 1,
        results: [{ id: "1234", service: "patreon", name: "Old Alpha", favorited: 0 }],
      });

      worker.emit({
        type: "searchResult",
        requestId: secondRequestId,
        total: 1,
        results: [{ id: "50049787", service: "patreon", name: "AYEH", favorited: 0 }],
      });
    });

    await screen.findByText("AYEH");
    expect(screen.queryByText("Old Alpha")).not.toBeInTheDocument();
  });
});
