import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.fn();
const fetchJsonWithMetaMock = vi.fn();

vi.mock("../utils/api.js", () => ({
  fetchJson: (...args) => fetchJsonMock(...args),
  fetchJsonWithMeta: (...args) => fetchJsonWithMetaMock(...args),
}));

import CreatorPage from "./CreatorPage.jsx";
import { PAGE_SIZE_KEY } from "../constants.js";
import { writeCreatorCache } from "../utils/cache.js";

function CreatorHarness({ initialFilter = "", alreadySaved = false, initialPosition = 0 }) {
  const [filter, setFilter] = useState(initialFilter);
  const [position, setPosition] = useState(initialPosition);
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

class FakeResizeObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.observe = vi.fn();
    this.disconnect = vi.fn();
    FakeResizeObserver.instances.push(this);
  }

  trigger() {
    this.callback([]);
  }
}

let mockScrollY = 0;

const buildPosts = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `post-${index + 1}`,
    title: `post ${index + 1}`,
    published: "2025-01-01T00:00:00.000Z",
  }));

const setScrollY = (value) => {
  mockScrollY = value;
};

const mockPostApi = (posts) => {
  fetchJsonMock.mockImplementation(async (url) => {
    const target = String(url);
    if (target.includes("/profile")) {
      return { id: "50049787", service: "patreon", name: "AYEH", post_count: posts.length };
    }
    if (target.includes("/posts?")) {
      const parsed = new URL(target, "https://example.invalid");
      const offset = Number(parsed.searchParams.get("o") || 0);
      const limit = Number(parsed.searchParams.get("n") || 50);
      return posts.slice(offset, offset + limit);
    }
    return [];
  });
};

const setupVirtualLayout = ({ initialWidth = 1200, initialCardHeight = 180 } = {}) => {
  let listWidth = initialWidth;
  let cardHeight = initialCardHeight;
  let postMeasureCount = 0;
  const hasClass = (node, className) => {
    if (!node) return false;
    if (node.classList && typeof node.classList.contains === "function") {
      return node.classList.contains(className);
    }
    const raw = typeof node.className === "string" ? node.className : "";
    return raw.split(/\s+/).includes(className);
  };

  const rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function mockRect() {
    if (hasClass(this, "post-item")) {
      postMeasureCount += 1;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 260,
        bottom: cardHeight,
        width: 260,
        height: cardHeight,
        toJSON: () => ({}),
      };
    }
    if (hasClass(this, "post-list")) {
      const scrollOffset = Number(window.scrollY) || 0;
      return {
        x: 0,
        y: -scrollOffset,
        top: -scrollOffset,
        left: 0,
        right: listWidth,
        bottom: 1200 - scrollOffset,
        width: listWidth,
        height: 1200,
        toJSON: () => ({}),
      };
    }
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    };
  });

  const clientWidthDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
  Object.defineProperty(Element.prototype, "clientWidth", {
    configurable: true,
    get() {
      if (hasClass(this, "post-list")) {
        return listWidth;
      }
      return 0;
    },
  });

  return {
    setWidth(next) {
      listWidth = next;
    },
    setCardHeight(next) {
      cardHeight = next;
    },
    getPostMeasureCount() {
      return postMeasureCount;
    },
    restore() {
      rectSpy.mockRestore();
      if (clientWidthDescriptor) {
        Object.defineProperty(Element.prototype, "clientWidth", clientWidthDescriptor);
      } else {
        delete Element.prototype.clientWidth;
      }
    },
  };
};

describe("CreatorPage virtualization behavior", () => {
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
    localStorage.setItem(PAGE_SIZE_KEY, "75");
    setupMatchMedia();

    FakeResizeObserver.instances = [];
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: FakeResizeObserver,
    });

    const raf = vi.fn((cb) => {
      cb();
      return 1;
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: raf,
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: () => {},
    });
    mockScrollY = 0;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => mockScrollY,
      set: (next) => {
        mockScrollY = Number(next) || 0;
      },
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 900,
    });
  });

  it("virtualizes large lists and renders non-zero spacers", async () => {
    const layout = setupVirtualLayout({ initialWidth: 1200, initialCardHeight: 180 });
    try {
      mockPostApi(buildPosts(180));
      render(<CreatorHarness />);

      await screen.findByText("post 1");

      await waitFor(() => {
        expect(document.querySelectorAll(".post-item").length).toBeGreaterThan(0);
      });

      const renderedCount = document.querySelectorAll(".post-item").length;
      expect(renderedCount).toBeLessThan(75);

      const spacers = Array.from(document.querySelectorAll(".post-list-spacer"));
      expect(spacers.length).toBeGreaterThan(0);
      const spacerHeights = spacers.map((node) => parseFloat(node.style.height || "0"));
      expect(Math.max(...spacerHeights)).toBeGreaterThan(0);
    } finally {
      layout.restore();
    }
  });

  it("registers scroll and resize listeners plus a ResizeObserver for virtualization updates", async () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const layout = setupVirtualLayout({ initialWidth: 1200, initialCardHeight: 180 });
    try {
      mockPostApi(buildPosts(180));
      render(<CreatorHarness />);

      await screen.findByText("post 1");
      expect(
        addEventListenerSpy.mock.calls.some((call) => call[0] === "scroll" && typeof call[1] === "function"),
      ).toBe(true);
      expect(
        addEventListenerSpy.mock.calls.some((call) => call[0] === "resize" && typeof call[1] === "function"),
      ).toBe(true);
      expect(FakeResizeObserver.instances.length).toBeGreaterThan(0);
      expect(FakeResizeObserver.instances.some((observer) => observer.observe.mock.calls.length > 0)).toBe(true);
    } finally {
      addEventListenerSpy.mockRestore();
      layout.restore();
    }
  });

  it("collects measured row heights and remeasures after display layout toggles", async () => {
    const layout = setupVirtualLayout({ initialWidth: 1200, initialCardHeight: 520 });
    try {
      mockPostApi(buildPosts(180));
      render(<CreatorHarness />);

      await screen.findByText("post 1");
      expect(FakeResizeObserver.instances.length).toBeGreaterThan(0);
      const resizeObserver =
        FakeResizeObserver.instances.find((observer) => observer.observe.mock.calls.length > 0) ||
        FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1];
      expect(resizeObserver.observe).toHaveBeenCalled();

      const measuredBeforeResize = layout.getPostMeasureCount();
      expect(measuredBeforeResize).toBeGreaterThan(0);
      fireEvent.click(screen.getByLabelText("Tags", { selector: "#show-tags" }));

      await waitFor(() => {
        expect(layout.getPostMeasureCount()).toBeGreaterThan(measuredBeforeResize);
      });
    } finally {
      layout.restore();
    }
  });
});
