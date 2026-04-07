import {
  copyReaderSettings,
  getInitialPageSize,
  getInitialReaderSettings,
  getTypefacePreviewStyle,
  normalizeReaderSettings,
  readBooleanPreference,
} from "./preferences.js";
import { API_PAGE_SIZE, PAGE_SIZE_KEY } from "../constants.js";

describe("preferences utils", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("readBooleanPreference reads true/false and falls back", () => {
    expect(readBooleanPreference("missing", true)).toBe(true);
    window.localStorage.setItem("flag", "true");
    expect(readBooleanPreference("flag", false)).toBe(true);
    window.localStorage.setItem("flag", "false");
    expect(readBooleanPreference("flag", true)).toBe(false);
  });

  it("getInitialPageSize returns stored valid values", () => {
    window.localStorage.setItem(PAGE_SIZE_KEY, "75");
    expect(getInitialPageSize()).toBe(75);
    window.localStorage.setItem(PAGE_SIZE_KEY, "999");
    expect(getInitialPageSize()).toBe(API_PAGE_SIZE);
  });

  it("getInitialPageSize falls back when storage access throws", () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("no access");
      });

    expect(getInitialPageSize()).toBe(API_PAGE_SIZE);
    getItemSpy.mockRestore();
  });

  it("normalizeReaderSettings supports legacy mappings", () => {
    const normalized = normalizeReaderSettings({
      galleryEnabled: true,
      typeface: "serif",
      textIndent: "medium",
      useOriginalAttachments: true,
    });

    expect(normalized.galleryMode).toBe("both");
    expect(normalized.typeface).toBe("merriweather");
    expect(normalized.textIndent).toBe("soft");
    expect(normalized.attachmentsMode).toBe("original");
  });

  it("getInitialReaderSettings loads and normalizes stored json", () => {
    window.localStorage.setItem(
      "reader.test",
      JSON.stringify({ textScale: "large", widthMode: "compact", typeface: "ibm-plex" }),
    );
    const settings = getInitialReaderSettings("reader.test");

    expect(settings.textScale).toBe("large");
    expect(settings.widthMode).toBe("compact");
    expect(settings.typeface).toBe("ibm-plex");
  });

  it("copyReaderSettings copies persisted payload", () => {
    window.localStorage.setItem("reader.from", JSON.stringify({ textScale: "small" }));
    copyReaderSettings("reader.from", "reader.to");

    expect(window.localStorage.getItem("reader.to")).toBe(JSON.stringify({ textScale: "small" }));
  });

  it("copyReaderSettings skips no-op key copies", () => {
    window.localStorage.setItem("reader.same", JSON.stringify({ textScale: "small" }));
    copyReaderSettings("reader.same", "reader.same");

    expect(window.localStorage.getItem("reader.same")).toBe(JSON.stringify({ textScale: "small" }));
  });

  it("copyReaderSettings ignores malformed or empty keys", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    copyReaderSettings("", "reader.to");
    copyReaderSettings("reader.from", "");
    copyReaderSettings(null, "reader.to");
    copyReaderSettings("reader.from", null);

    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it("copyReaderSettings does not write when source key has no stored value", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    copyReaderSettings("reader.missing", "reader.to");

    expect(window.localStorage.getItem("reader.to")).toBeNull();
    expect(setItemSpy).not.toHaveBeenCalled();

    setItemSpy.mockRestore();
  });

  it("readBooleanPreference and reader settings handle storage failures safely", () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });

    expect(readBooleanPreference("any", true)).toBe(true);
    expect(getInitialReaderSettings("reader.missing")).toEqual(
      expect.objectContaining({ textScale: "base" }),
    );

    getItemSpy.mockRestore();
  });

  it("normalizeReaderSettings handles fallback gallery/typeface values", () => {
    const normalized = normalizeReaderSettings({
      galleryMode: "invalid",
      serifBody: false,
      typeface: "missing",
    });

    expect(normalized.galleryMode).toBe("none");
    expect(normalized.typeface).toBe("default");
  });

  it("getTypefacePreviewStyle resolves known styles only", () => {
    expect(getTypefacePreviewStyle("ibm-plex")).toEqual(
      expect.objectContaining({ fontFamily: expect.stringContaining("IBM Plex Sans") }),
    );
    expect(getTypefacePreviewStyle("unknown")).toBeUndefined();
  });

  it("returns safe defaults when window is unavailable", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    try {
      expect(readBooleanPreference("flag", true)).toBe(true);
      expect(getInitialPageSize()).toBe(API_PAGE_SIZE);
      expect(getInitialReaderSettings("reader.any")).toEqual(
        expect.objectContaining({ textScale: "base" }),
      );
      expect(() => copyReaderSettings("reader.from", "reader.to")).not.toThrow();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "window", originalDescriptor);
      }
    }
  });
});
