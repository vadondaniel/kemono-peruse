import { fetchJson } from "./api.js";

describe("fetchJson", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns parsed json for successful requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: 1 }),
      }),
    );

    await expect(fetchJson("/ok")).resolves.toEqual({ ok: 1 });
  });

  it("returns null when request fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    await expect(fetchJson("/fail")).resolves.toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("dedupes concurrent requests by default", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([fetchJson("/shared"), fetchJson("/shared")]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null for aborted requests without logging errors", async () => {
    const controller = new AbortController();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url, options) => {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
          setTimeout(() => resolve({ ok: true, json: async () => ({ never: "used" }) }), 20);
        });
      }),
    );

    const pending = fetchJson("/abort-me", { signal: controller.signal, dedupe: false });
    controller.abort();

    await expect(pending).resolves.toBeNull();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("allows deduped subscribers to abort without cancelling the shared request", async () => {
    let resolveFetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    const controller = new AbortController();
    const first = fetchJson("/shared", { dedupeKey: "creator:50049787" });
    const second = fetchJson("/another", {
      dedupeKey: "creator:50049787",
      signal: controller.signal,
    });

    controller.abort();
    resolveFetch({
      ok: true,
      json: async () => ({ ok: "shared" }),
    });

    await expect(first).resolves.toEqual({ ok: "shared" });
    await expect(second).resolves.toBeNull();
  });

  it("handles already-aborted caller signals when dedupe is disabled", async () => {
    const controller = new AbortController();
    controller.abort();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url, options) => {
        const error = new Error("aborted");
        if (options.signal?.aborted) {
          error.name = "AbortError";
          throw error;
        }
        return { ok: true, json: async () => ({ unexpected: true }) };
      }),
    );

    await expect(fetchJson("/aborted", { signal: controller.signal, dedupe: false })).resolves.toBeNull();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("aborts slow requests when timeout is reached", async () => {
    vi.useFakeTimers();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, options) => {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("timeout");
            error.name = "AbortError";
            reject(error);
          });
        });
      }),
    );

    const pending = fetchJson("/slow", { timeoutMs: 5, dedupe: false });
    await vi.advanceTimersByTimeAsync(5);

    await expect(pending).resolves.toBeNull();
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
