import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MEDIA_BASE } from "../constants.js";

const fetchJsonMock = vi.fn();
const fetchJsonWithMetaMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
  fetchJsonWithMeta: (...args) => fetchJsonWithMetaMock(...args),
}));

import CreatorPage from "./CreatorPage.jsx";
import { writeCreatorCache } from "../utils/cache.js";

function CreatorHarness({ initialFilter = "", alreadySaved = false }) {
  const [filter, setFilter] = useState(initialFilter);
  const [position, setPosition] = useState(0);
  return (
    <CreatorPage
      service="patreon"
      creatorId="50049787"
      creatorName="AYEH"
      alreadySaved={alreadySaved}
      onOpenPost={vi.fn()}
      onSave={vi.fn()}
      activeFilter={filter}
      onUpdateFilter={setFilter}
      onRememberPosition={setPosition}
      initialPosition={position}
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

class FakeIntersectionObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.observe = vi.fn();
    this.unobserve = vi.fn();
    this.disconnect = vi.fn();
    FakeIntersectionObserver.instances.push(this);
  }

  trigger(entries) {
    this.callback(entries);
  }
}

const buildRect = ({ top = 0, left = 0, width = 260, height = 180 } = {}) => {
  const right = left + width;
  const bottom = top + height;
  return {
    x: left,
    y: top,
    top,
    left,
    right,
    bottom,
    width,
    height,
    toJSON: () => ({}),
  };
};

const mockPostApi = (posts) => {
  fetchJsonMock.mockImplementation(async (url) => {
    const target = String(url);
    if (target.includes("/profile")) {
      return { id: "50049787", service: "patreon", name: "AYEH", post_count: posts.length };
    }
    if (target.includes("/posts?")) {
      return posts;
    }
    return [];
  });
};

describe("CreatorPage feature backgrounds", () => {
  const postsWithFeatureImages = [
    {
      id: "1",
      title: "post 1",
      published: "2025-01-01T00:00:00.000Z",
      file: { path: "/images/one.jpg" },
    },
    {
      id: "2",
      title: "post 2",
      published: "2025-01-01T00:10:00.000Z",
      file: { path: "/images/two.jpg" },
    },
  ];

  beforeEach(() => {
    cleanup();
    fetchJsonMock.mockReset();
    fetchJsonWithMetaMock.mockReset();
    fetchJsonWithMetaMock.mockImplementation(async (...args) => ({
      data: await fetchJsonMock(...args),
      status: 200,
      notModified: false,
      etag: "",
      lastModified: "",
    }));
    localStorage.clear();
    writeCreatorCache("patreon", "50049787", null);
    setupMatchMedia();
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 800,
    });
  });

  it("falls back to eager feature loading when IntersectionObserver is unavailable", async () => {
    mockPostApi(postsWithFeatureImages);
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    render(<CreatorHarness />);

    await screen.findByText("post 1");
    fireEvent.click(screen.getByLabelText("Feature image", { selector: "#show-feature-bg" }));

    await waitFor(() => {
      expect(document.querySelectorAll(".post-item.feature-background")).toHaveLength(2);
    });

    const firstCard = screen.getByText("post 1").closest(".post-item");
    expect(firstCard).toBeTruthy();
    expect(firstCard.style.getPropertyValue("--post-feature-image")).toContain(`${MEDIA_BASE}/images/one.jpg`);
  });

  it("prefetches near-viewport cards and observes far cards until they intersect", async () => {
    mockPostApi(postsWithFeatureImages);
    FakeIntersectionObserver.instances = [];
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: FakeIntersectionObserver,
    });

    const rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function mockRect() {
      const key = this.getAttribute("data-feature-key");
      if (key === "post-1") {
        return buildRect({ top: 120, height: 180 });
      }
      if (key === "post-2") {
        return buildRect({ top: 1800, height: 180 });
      }
      return buildRect();
    });

    try {
      render(<CreatorHarness />);

      await screen.findByText("post 1");
      fireEvent.click(screen.getByLabelText("Feature image", { selector: "#show-feature-bg" }));

      await waitFor(() => {
        expect(FakeIntersectionObserver.instances).toHaveLength(1);
      });
      const observer = FakeIntersectionObserver.instances[0];
      const firstCard = screen.getByText("post 1").closest(".post-item");
      const secondCard = screen.getByText("post 2").closest(".post-item");

      expect(firstCard).toBeTruthy();
      expect(secondCard).toBeTruthy();

      await waitFor(() => {
        expect(firstCard).toHaveClass("feature-background");
      });
      expect(secondCard).not.toHaveClass("feature-background");
      expect(observer.observe).toHaveBeenCalledWith(secondCard);

      observer.trigger([
        {
          target: secondCard,
          isIntersecting: true,
          intersectionRatio: 1,
        },
      ]);

      await waitFor(() => {
        expect(secondCard).toHaveClass("feature-background");
      });
      expect(observer.unobserve).toHaveBeenCalledWith(secondCard);
    } finally {
      rectSpy.mockRestore();
    }
  });
});

