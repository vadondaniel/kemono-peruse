import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
}));

import CreatorPage from "./CreatorPage.jsx";

function CreatorHarness({ initialFilter = "alpha" }) {
  const [filter, setFilter] = useState(initialFilter);
  return (
    <CreatorPage
      service="patreon"
      creatorId="50049787"
      creatorName="AYEH"
      alreadySaved={false}
      onOpenPost={vi.fn()}
      onSave={vi.fn()}
      activeFilter={filter}
      onUpdateFilter={setFilter}
      onRememberPosition={vi.fn()}
      initialPosition={0}
    />
  );
}

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

describe("CreatorPage search behavior", () => {
  beforeEach(() => {
    cleanup();
    fetchJsonMock.mockReset();
    localStorage.clear();
    setupMatchMedia();
  });

  it("uses tag mode with body=true when tags-only filter is active", async () => {
    localStorage.setItem(
      "kemono.filterFields.patreon.50049787",
      JSON.stringify({ title: false, tags: true, body: false }),
    );

    fetchJsonMock.mockImplementation(async (url) => {
      if (url.includes("/profile")) {
        return { id: "50049787", service: "patreon", name: "AYEH", post_count: 1 };
      }
      if (url.includes("&tag=alpha")) {
        return [{ id: "tag-post", title: "Tagged Post", tags: ["alpha"] }];
      }
      return [];
    });

    render(<CreatorHarness initialFilter="alpha" />);

    await screen.findByText("Tagged Post");

    const urls = fetchJsonMock.mock.calls.map((call) => String(call[0]));
    const tagUrl = urls.find((url) => url.includes("&tag=alpha"));
    expect(tagUrl).toBeTruthy();
    expect(tagUrl).toContain("&body=true");
  });

  it("combines title/body and tag matches as OR when both are enabled", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      if (url.includes("/profile")) {
        return { id: "50049787", service: "patreon", name: "AYEH", post_count: 3 };
      }
      if (url.includes("&q=alpha")) {
        return [
          { id: "text-match", title: "alpha title", tags: ["zzz"] },
          { id: "not-a-match", title: "completely different", tags: ["zzz"] },
        ];
      }
      if (url.includes("&tag=alpha")) {
        return [{ id: "tag-match", title: "plain title", tags: ["alpha"] }];
      }
      return [];
    });

    render(<CreatorHarness initialFilter="alpha" />);

    await screen.findByText("alpha title");
    await screen.findByText("plain title");

    expect(screen.queryByText("completely different")).not.toBeInTheDocument();

    const urls = fetchJsonMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("&q=alpha"))).toBe(true);
    expect(urls.some((url) => url.includes("&tag=alpha"))).toBe(true);
  });

  it("resets filter state when clear is clicked", async () => {
    fetchJsonMock.mockImplementation(async (url) => {
      if (url.includes("/profile")) {
        return { id: "50049787", service: "patreon", name: "AYEH", post_count: 1 };
      }
      if (url.includes("&q=alpha")) {
        return [{ id: "text-match", title: "alpha title", tags: ["zzz"] }];
      }
      return [];
    });

    render(<CreatorHarness initialFilter="alpha" />);
    await screen.findByText("alpha title");

    const clearButton = screen.getByRole("button", { name: /clear/i });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(screen.queryByText("alpha title")).not.toBeInTheDocument();
    });
  });
});
