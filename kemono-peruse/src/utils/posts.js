import { SERVICE_LABELS } from "../constants";

export function normalizePostHtml(rawHtml, options = {}) {
  if (!rawHtml || typeof rawHtml !== "string") return "";

  const { service, attachments, mediaBase } = options;
  let html = rawHtml.replace(/src=(["'])\/(?!\/)/gi, 'src=$1https://kemono.cr/');

  const isFanbox = (service || "").toLowerCase() === "fanbox";
  const canUseDomParser =
    typeof window !== "undefined" && typeof window.DOMParser !== "undefined" && typeof document !== "undefined";

  if (!isFanbox || !canUseDomParser || !mediaBase || !Array.isArray(attachments) || attachments.length === 0) {
    return html;
  }

  try {
    const parser = new window.DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    if (doc?.body) {
      const mutated = convertFanboxAnchorsToImages(doc, attachments, mediaBase);
      if (mutated) {
        return doc.body.innerHTML;
      }
    }
  } catch (error) {
    console.warn("Failed to normalize Fanbox HTML", error);
  }

  return html;
}

function convertFanboxAnchorsToImages(doc, attachments, mediaBase) {
  const anchors = Array.from(doc.querySelectorAll("a[href]"));
  if (anchors.length === 0) return false;

  const lookup = buildAttachmentLookup(attachments);
  if (lookup.size === 0) return false;

  let mutated = false;

  anchors.forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    const key = extractFanboxFilenameFromHref(href);
    if (!key) return;
    const attachment = lookup.get(key);
    if (!attachment?.path) return;

    const img = doc.createElement("img");
    img.setAttribute("src", `${mediaBase}${attachment.path}`);
    img.setAttribute("alt", attachment.name || attachment.path.split("/").pop() || "");
    img.setAttribute("loading", "lazy");
    img.classList.add("inline-media");

    anchor.replaceWith(img);
    mutated = true;
  });

  return mutated;
}

function buildAttachmentLookup(attachments) {
  const lookup = new Map();
  attachments.forEach((item) => {
    if (!item) return;
    const keys = [
      normalizeAttachmentKey(item.name),
      normalizeAttachmentKey(item.path ? item.path.split("/").pop() : null),
    ].filter(Boolean);

    keys.forEach((key) => {
      if (key && !lookup.has(key)) {
        lookup.set(key, item);
      }
    });
  });
  return lookup;
}

function normalizeAttachmentKey(value) {
  if (!value || typeof value !== "string") return null;
  return value.trim().toLowerCase();
}

function extractFanboxFilenameFromHref(href) {
  if (!href || typeof href !== "string") return null;
  try {
    const url = href.startsWith("http") ? new URL(href) : new URL(href, "https://downloads.fanbox.cc");
    if (url.hostname !== "downloads.fanbox.cc") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    const filename = segments[segments.length - 1];
    return normalizeAttachmentKey(filename);
  } catch {
    return null;
  }
}

export function escapeHtml(value) {
  if (typeof value !== "string" || value.length === 0) return "";
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (char) => map[char] || char);
}

export function getPostExcerptHtml(post) {
  if (!post) return null;
  const candidates = [
    post.excerpt,
    post.snippet,
    post.summary,
    post.match,
    post.content,
    post.body,
    post.text,
    post.description,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === "string") {
      const plain = candidate.replace(/<[^>]+>/g, "").trim();
      if (!plain) continue;
      const limit = 240;
      const snippet = plain.length > limit ? `${plain.slice(0, limit).trimEnd()}...` : plain;
      return escapeHtml(snippet);
    }
    if (candidate && typeof candidate === "object") {
      const values = Object.values(candidate).filter((value) => typeof value === "string" && value.trim().length > 0);
      if (!values.length) continue;
      const plain = values.join(" ").replace(/<[^>]+>/g, "").trim();
      if (!plain) continue;
      const limit = 240;
      const snippet = plain.length > limit ? `${plain.slice(0, limit).trimEnd()}...` : plain;
      return escapeHtml(snippet);
    }
  }

  return null;
}

export function extractTagTokens(value) {
  return String(value || "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

export function toNumericCount(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const digits = value.replace(/[^\d]/g, "");
    if (!digits) return null;
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function getServiceLabel(service) {
  if (!service) return "";
  const key = String(service).toLowerCase();
  if (SERVICE_LABELS[key]) return SERVICE_LABELS[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}
