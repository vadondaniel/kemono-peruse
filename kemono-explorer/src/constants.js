const rawApiBase = import.meta.env.VITE_API_BASE || "/api/proxy/kemono";

export const API_BASE = rawApiBase.endsWith("/") ? rawApiBase.slice(0, -1) : rawApiBase;
export const MEDIA_BASE = `${API_BASE}/media`;
const rawOriginalMediaBase = import.meta.env.VITE_ORIGINAL_MEDIA_BASE || "https://kemono.cr/data";
export const ORIGINAL_MEDIA_BASE = rawOriginalMediaBase.endsWith("/")
  ? rawOriginalMediaBase.slice(0, -1)
  : rawOriginalMediaBase;
export const ICON_BASE = "https://img.kemono.cr/icons";
export const API_PAGE_SIZE = 50;
export const MAX_SEARCH_RESULTS = 1000;
export const MAX_CACHE_POSTS = 1000;
export const MAX_CACHE_POST_DETAILS = 100;
export const CACHE_VERSION = 1;
export const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;
export const CACHE_PREF_PREFIX = "kemono.cache.pref";
export const CACHE_DATA_PREFIX = "kemono.cache";
export const PAGE_SIZE_OPTIONS = [25, 50, 75, 100, 125, 150];
export const PAGE_SIZE_KEY = "kemono.pageSize";

export const READER_TEXT_SCALE_OPTIONS = [
  { value: "small", label: "Small" },
  { value: "base", label: "Default" },
  { value: "large", label: "Large" },
];
export const READER_LINE_SPACING_OPTIONS = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "relaxed", label: "Relaxed" },
];
export const READER_WIDTH_OPTIONS = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "full", label: "Full" },
];
export const READER_TYPEFACE_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "source-sans", label: "Source Sans" },
  { value: "ibm-plex", label: "IBM Plex" },
  { value: "merriweather", label: "Merriweather" },
  { value: "cormorant", label: "Cormorant" },
  { value: "literata", label: "Literata" },
];
export const READER_ALIGNMENT_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "justify", label: "Justify" },
];
export const READER_INDENT_OPTIONS = [
  { value: "none", label: "None" },
  { value: "soft", label: "Soft" },
  { value: "deep", label: "Deep" },
];
export const READER_ATTACHMENT_LINK_OPTIONS = [
  { value: "proxy", label: "Proxy links" },
  { value: "original", label: "Original host" },
];
export const READER_VIEW_MODE_OPTIONS = [
  { value: "reader", label: "Reader" },
  { value: "gallery", label: "Gallery" },
];

export const READER_TYPEFACE_VALUES = READER_TYPEFACE_OPTIONS.map((option) => option.value);
export const READER_TEXT_SCALE_VALUES = READER_TEXT_SCALE_OPTIONS.map((option) => option.value);
export const READER_LINE_SPACING_VALUES = READER_LINE_SPACING_OPTIONS.map((option) => option.value);
export const READER_WIDTH_VALUES = READER_WIDTH_OPTIONS.map((option) => option.value);
export const READER_ALIGNMENT_VALUES = READER_ALIGNMENT_OPTIONS.map((option) => option.value);
export const READER_INDENT_VALUES = READER_INDENT_OPTIONS.map((option) => option.value);
export const READER_ATTACHMENT_LINK_VALUES = READER_ATTACHMENT_LINK_OPTIONS.map((option) => option.value);
export const READER_VIEW_MODE_VALUES = READER_VIEW_MODE_OPTIONS.map((option) => option.value);

export const READER_SETTINGS_KEY = "kemono.readerSettings";
export const READER_SETTINGS_UNSAVED_KEY = "kemono.readerSettings.unsaved";
export const DEFAULT_READER_SETTINGS = {
  viewMode: "reader",
  textScale: "base",
  lineSpacing: "normal",
  widthMode: "full",
  typeface: "default",
  textAlign: "left",
  textIndent: "none",
  attachmentsMode: "original",
};

export const TYPEFACE_PREVIEW_MAP = {
  default: 'var(--reader-font-default, "Inter", system-ui, -apple-system, "Segoe UI", sans-serif)',
  "source-sans": '"Source Sans 3", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  "ibm-plex": '"IBM Plex Sans", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  merriweather: '"Merriweather", "Source Serif 4", "Georgia", serif',
  cormorant: '"Cormorant Garamond", "Merriweather", "Georgia", serif',
  literata: '"Literata", "Merriweather", "Georgia", serif',
};

export const SERVICE_LABELS = {
  patreon: "Patreon",
  fanbox: "Pixiv Fanbox",
  fantia: "Fantia",
  discord: "Discord",
  gumroad: "Gumroad",
  dlsite: "DLsite",
};

export const RAW_BASE_PATH = (import.meta.env && import.meta.env.BASE_URL) || "/";
