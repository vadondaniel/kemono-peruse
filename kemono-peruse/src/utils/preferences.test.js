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
});
