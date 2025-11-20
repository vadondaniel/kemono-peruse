import { RAW_BASE_PATH, SERVICE_LABELS } from "../constants";

const BASE_TITLE = "Kemono Explorer";

export function normalizeBasePath(value) {
  if (typeof value !== "string" || value.length === 0) {
    return "/";
  }
  let next = value.trim();
  if (!next.startsWith("/")) {
    next = `/${next}`;
  }
  if (!next.endsWith("/")) {
    next = `${next}/`;
  }
  return next.replace(/\/{2,}/g, "/");
}

export const NORMALIZED_BASE_PATH = normalizeBasePath(RAW_BASE_PATH);
const BASE_PATH_PREFIX = NORMALIZED_BASE_PATH === "/" ? "" : NORMALIZED_BASE_PATH.slice(0, -1);

export function stripBasePath(pathname) {
  if (typeof pathname !== "string" || pathname.length === 0) {
    return "/";
  }
  if (!BASE_PATH_PREFIX) {
    return pathname || "/";
  }
  if (pathname === BASE_PATH_PREFIX) {
    return "/";
  }
  if (pathname.startsWith(`${BASE_PATH_PREFIX}/`)) {
    const remainder = pathname.slice(BASE_PATH_PREFIX.length);
    return remainder || "/";
  }
  return pathname || "/";
}

export function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodePathSegment(value) {
  if (typeof value !== "string") {
    return "";
  }
  return encodeURIComponent(value);
}

function safeString(value) {
  return typeof value === "string" ? value : "";
}

function toViewOrNull(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.name === "home") {
    return { name: "home" };
  }
  if (raw.name === "creator") {
    const service = safeString(raw.service);
    const creatorId = safeString(raw.creatorId);
    if (!service || !creatorId) return null;
    return {
      name: "creator",
      service,
      creatorId,
      creatorName: safeString(raw.creatorName),
    };
  }
  if (raw.name === "post") {
    const service = safeString(raw.service);
    const creatorId = safeString(raw.creatorId);
    const postId = safeString(raw.postId);
    if (!service || !creatorId || !postId) return null;
    return {
      name: "post",
      service,
      creatorId,
      creatorName: safeString(raw.creatorName),
      postId,
      postTitle: safeString(raw.postTitle),
    };
  }
  return null;
}

export function ensureView(raw) {
  return toViewOrNull(raw) || { name: "home" };
}

function parseViewFromPath(pathname) {
  const stripped = stripBasePath(pathname || "/");
  if (!stripped || stripped === "/") {
    return { name: "home" };
  }
  const segments = stripped.split("/").filter(Boolean).map(decodePathSegment);
  if (segments.length >= 5 && segments[0] === "creator" && segments[3] === "post") {
    return ensureView({
      name: "post",
      service: segments[1],
      creatorId: segments[2],
      creatorName: "",
      postId: segments[4],
    });
  }
  if (segments.length >= 3 && segments[0] === "creator") {
    return ensureView({
      name: "creator",
      service: segments[1],
      creatorId: segments[2],
      creatorName: "",
    });
  }
  return { name: "home" };
}

export function getViewFromHistoryState(state, pathname) {
  const fromState = toViewOrNull(state?.view);
  if (fromState) {
    return fromState;
  }
  return parseViewFromPath(pathname);
}

export function viewsEqual(a, b) {
  const viewA = ensureView(a);
  const viewB = ensureView(b);
  if (viewA.name !== viewB.name) return false;
  if (viewA.name === "home") return true;
  if (viewA.name === "creator") {
    return (
      viewA.service === viewB.service &&
      viewA.creatorId === viewB.creatorId &&
      viewA.creatorName === viewB.creatorName
    );
  }
  if (viewA.name === "post") {
    return (
      viewA.service === viewB.service &&
      viewA.creatorId === viewB.creatorId &&
      viewA.postId === viewB.postId &&
      viewA.creatorName === viewB.creatorName
    );
  }
  return false;
}

export function getUrlForView(view) {
  const normalized = ensureView(view);
  const segments = [];
  if (normalized.name === "creator" || normalized.name === "post") {
    segments.push("creator", normalized.service, normalized.creatorId);
    if (normalized.name === "post") {
      segments.push("post", normalized.postId);
    }
  }
  const encodedSegments = segments.map(encodePathSegment);
  const suffix = encodedSegments.length > 0 ? `/${encodedSegments.join("/")}` : "/";
  return BASE_PATH_PREFIX ? `${BASE_PATH_PREFIX}${suffix}` : suffix;
}

export function getTitleForView(view) {
  const normalized = ensureView(view);
  if (normalized.name === "creator") {
    const creatorLabel = normalized.creatorName || normalized.creatorId || "Creator";
    const serviceLabel = SERVICE_LABELS[normalized.service] || normalized.service || "";
    const dynamic = serviceLabel ? `${creatorLabel} (${serviceLabel})` : creatorLabel;
    return `${dynamic} | ${BASE_TITLE}`;
  }
  if (normalized.name === "post") {
    const title = normalized.postTitle || normalized.postId || "Post";
    const creatorLabel = normalized.creatorName || normalized.creatorId || "";
    const serviceLabel = SERVICE_LABELS[normalized.service] || normalized.service || "";
    const creatorPart = creatorLabel
      ? serviceLabel
        ? `${creatorLabel} (${serviceLabel})`
        : creatorLabel
      : serviceLabel;
    const segments = [title];
    if (creatorPart) {
      segments.push(creatorPart);
    }
    segments.push(BASE_TITLE);
    return segments.join(" | ");
  }
  return BASE_TITLE;
}

export function getInitialView() {
  if (typeof window === "undefined") {
    return { name: "home" };
  }
  const fromState = toViewOrNull(window.history?.state?.view);
  if (fromState) {
    return fromState;
  }
  return parseViewFromPath(window.location.pathname);
}

export function buildHistoryState(view) {
  return { view: { ...ensureView(view) } };
}
