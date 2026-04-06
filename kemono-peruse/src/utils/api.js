const DEFAULT_TIMEOUT_MS = 15000;
const inFlightRequests = new Map();

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

export async function fetchJson(url, options = {}) {
  const {
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    headers,
    dedupe = true,
    dedupeKey,
  } = options || {};

  const requestKey = dedupe ? dedupeKey || url : null;
  const sharedRequest = requestKey ? inFlightRequests.get(requestKey) : null;
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
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return await res.json();
    } catch (error) {
      if (!isAbortError(error)) {
        console.error("fetchJson failed", error);
      }
      return null;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (detachAbort) detachAbort();
    }
  })();

  if (requestKey) {
    const tracked = fetchPromise.finally(() => {
      inFlightRequests.delete(requestKey);
    });
    inFlightRequests.set(requestKey, tracked);
    return attachAbortListener(tracked, signal);
  }

  return fetchPromise;
}
