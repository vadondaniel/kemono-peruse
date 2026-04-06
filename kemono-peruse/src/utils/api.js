const DEFAULT_TIMEOUT_MS = 15000;
const inFlightRequests = new Map();
const inFlightMetaRequests = new Map();

const isAbortError = (error) => error?.name === "AbortError";

const attachAbortListener = (promise, signal) => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(null);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
};

const resolveHeaderValue = (headers, name) => {
  if (!headers || typeof headers.get !== "function" || !name) return "";
  const value = headers.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const createEmptyMetaResponse = () => ({
  data: null,
  status: null,
  notModified: false,
  etag: "",
  lastModified: "",
});

const requestJsonWithMeta = async (url, options = {}, inFlightMap) => {
  const {
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    headers,
    dedupe = true,
    dedupeKey,
  } = options || {};

  const requestKey = dedupe ? dedupeKey || url : null;
  const sharedRequest = requestKey ? inFlightMap.get(requestKey) : null;
  if (sharedRequest) {
    return attachAbortListener(sharedRequest, signal);
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timeoutId = null;
  let detachAbort = null;

  if (controller && signal && !requestKey) {
    if (signal.aborted) {
      controller.abort();
    } else {
      const onAbort = () => controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      detachAbort = () => signal.removeEventListener("abort", onAbort);
    }
  }

  if (controller && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
  }

  const fetchPromise = (async () => {
    try {
      const res = await fetch(url, {
        headers: { Accept: "text/css", ...(headers || {}) },
        signal: controller ? controller.signal : signal,
      });
      const etag = resolveHeaderValue(res.headers, "ETag");
      const lastModified = resolveHeaderValue(res.headers, "Last-Modified");
      if (res.status === 304) {
        return {
          data: null,
          status: 304,
          notModified: true,
          etag,
          lastModified,
        };
      }
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return {
        data: await res.json(),
        status: res.status,
        notModified: false,
        etag,
        lastModified,
      };
    } catch (error) {
      if (!isAbortError(error)) {
        console.error("fetchJsonWithMeta failed", error);
      }
      return createEmptyMetaResponse();
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (detachAbort) detachAbort();
    }
  })();

  if (requestKey) {
    const tracked = fetchPromise.finally(() => {
      inFlightMap.delete(requestKey);
    });
    inFlightMap.set(requestKey, tracked);
    return attachAbortListener(tracked, signal);
  }

  return fetchPromise;
};

export async function fetchJsonWithMeta(url, options = {}) {
  const response = await requestJsonWithMeta(url, options, inFlightMetaRequests);
  return response || createEmptyMetaResponse();
}

export async function fetchJson(url, options = {}) {
  const response = await requestJsonWithMeta(url, options, inFlightRequests);
  if (!response || response.notModified) {
    return null;
  }
  return response.data;
}
