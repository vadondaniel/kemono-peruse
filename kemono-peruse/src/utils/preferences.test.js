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

  it("getTypefacePreviewStyle resolves known styles only", () => {
    expect(getTypefacePreviewStyle("ibm-plex")).toEqual(
      expect.objectContaining({ fontFamily: expect.stringContaining("IBM Plex Sans") }),
    );
    expect(getTypefacePreviewStyle("unknown")).toBeUndefined();
  });
});
