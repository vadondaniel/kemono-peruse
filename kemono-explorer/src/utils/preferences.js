import {
  API_PAGE_SIZE,
  DEFAULT_READER_SETTINGS,
  PAGE_SIZE_KEY,
  PAGE_SIZE_OPTIONS,
  READER_ALIGNMENT_VALUES,
  READER_ATTACHMENT_LINK_VALUES,
  READER_INDENT_VALUES,
  READER_LINE_SPACING_VALUES,
  READER_SETTINGS_KEY,
  READER_SETTINGS_UNSAVED_KEY,
  READER_TEXT_SCALE_VALUES,
  READER_TYPEFACE_VALUES,
  READER_VIEW_MODE_VALUES,
  READER_WIDTH_VALUES,
  TYPEFACE_PREVIEW_MAP,
} from "../constants";

export function readBooleanPreference(key, fallback = false) {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    // ignore persistence issues
  }
  return fallback;
}

export function getInitialPageSize() {
  if (typeof window === "undefined" || !window.localStorage) {
    return API_PAGE_SIZE;
  }
  try {
    const stored = parseInt(window.localStorage.getItem(PAGE_SIZE_KEY) || "", 10);
    if (PAGE_SIZE_OPTIONS.includes(stored)) {
      return stored;
    }
  } catch {
    // ignore invalid persisted values
  }
  return API_PAGE_SIZE;
}

export function normalizeReaderSettings(raw) {
  const normalized = { ...DEFAULT_READER_SETTINGS };
  if (!raw || typeof raw !== "object") return normalized;
  if (READER_VIEW_MODE_VALUES.includes(raw.viewMode)) {
    normalized.viewMode = raw.viewMode;
  }
  if (READER_TEXT_SCALE_VALUES.includes(raw.textScale)) {
    normalized.textScale = raw.textScale;
  }
  if (READER_LINE_SPACING_VALUES.includes(raw.lineSpacing)) {
    normalized.lineSpacing = raw.lineSpacing;
  }
  if (READER_WIDTH_VALUES.includes(raw.widthMode)) {
    normalized.widthMode = raw.widthMode;
  }
  if (raw.typeface && typeof raw.typeface === "string") {
    if (READER_TYPEFACE_VALUES.includes(raw.typeface)) {
      normalized.typeface = raw.typeface;
    } else {
      const legacyMap = {
        sans: "default",
        serif: "merriweather",
        "system-sans": "default",
        "system-serif": "merriweather",
        plex: "ibm-plex",
        "plex-sans": "ibm-plex",
        garamond: "cormorant",
        "source-sans": "source-sans",
        merriweather: "merriweather",
        cormorant: "cormorant",
        literata: "literata",
      };
      if (legacyMap[raw.typeface]) {
        normalized.typeface = legacyMap[raw.typeface];
      }
    }
  } else if (raw.serifBody === true) {
    normalized.typeface = "merriweather";
  } else if (raw.serifBody === false) {
    normalized.typeface = "default";
  }
  if (READER_ALIGNMENT_VALUES.includes(raw.textAlign)) {
    normalized.textAlign = raw.textAlign;
  }
  if (READER_INDENT_VALUES.includes(raw.textIndent)) {
    normalized.textIndent = raw.textIndent;
  } else if (raw.textIndent === "medium") {
    normalized.textIndent = "soft";
  }
  if (READER_ATTACHMENT_LINK_VALUES.includes(raw.attachmentsMode)) {
    normalized.attachmentsMode = raw.attachmentsMode;
  } else if (raw.useOriginalAttachments === true) {
    normalized.attachmentsMode = "original";
  }
  return normalized;
}

export function getInitialReaderSettings(storageKey = READER_SETTINGS_KEY) {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...DEFAULT_READER_SETTINGS };
  }
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return { ...DEFAULT_READER_SETTINGS };
    const parsed = JSON.parse(stored);
    return normalizeReaderSettings(parsed);
  } catch {
    return { ...DEFAULT_READER_SETTINGS };
  }
}

export function copyReaderSettings(fromKey = READER_SETTINGS_UNSAVED_KEY, toKey = READER_SETTINGS_KEY) {
  if (typeof window === "undefined" || !window.localStorage) return;
  if (!fromKey || !toKey || fromKey === toKey) return;
  try {
    const stored = window.localStorage.getItem(fromKey);
    if (!stored) return;
    window.localStorage.setItem(toKey, stored);
  } catch {
    // ignore copy failures
  }
}

export function getTypefacePreviewStyle(value) {
  const family = TYPEFACE_PREVIEW_MAP[value];
  return family ? { fontFamily: family } : undefined;
}
