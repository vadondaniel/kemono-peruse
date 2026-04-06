import { fetchJson } from "./api.js";

describe("fetchJson", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
