import upstream from "../../proxy-upstream.cjs";

const { fetchArchive, normalizeTags } = upstream;
const api = "https://kemono.cr/api/v1/patreon/user/123/posts?o=50&q=chapter&tag=Novel";
const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" },
});

describe("Pawchive compatibility and Kemono fallback", () => {
  it("uses Pawchive first, preserving pagination and search, and normalizes tags and file URLs", async () => {
    const fetch = vi.fn().mockResolvedValue(response([{
      id: "1", tags: '{Novel,"Tag, with comma"}',
      file: { path: "/abc/image.png", server: "https://n3.pawchive.pw" },
      content: '<img src="/data/abc/image.png">',
    }]));
    const res = await fetchArchive(api, {}, { fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe(api.replace("kemono.cr", "pawchive.pw"));
    const [post] = await res.json();
    expect(post.tags).toEqual(["Novel", "Tag, with comma"]);
    expect(post.file.original).toBe("https://n3.pawchive.pw/data/abc/image.png");
    expect(post.file.path).toBe("/__pawchive/n3.pawchive.pw/data/abc/image.png");
    expect(post.content).toContain("/api/proxy/kemono/media/__pawchive/n3.pawchive.pw/data/");
  });

  it.each([404, 429, 500])("falls back on HTTP %s and retains Kemono media provenance", async (status) => {
    const fetch = vi.fn().mockResolvedValueOnce(response({}, status))
      .mockResolvedValueOnce(response([{ id: "2", file: { path: "/hash.png" } }]));
    const res = await fetchArchive(api, {}, { fetch });
    expect(String(fetch.mock.calls[1][0])).toBe(api);
    expect((await res.json())[0].file.original).toBe("https://kemono.cr/data/hash.png");
  });

  it("falls back on network errors and invalid JSON payloads", async () => {
    for (const first of [() => Promise.reject(new Error("offline")), () => Promise.resolve(new Response("<html>challenge</html>")), () => Promise.resolve(response({ error: "challenge" }))]) {
      const fetch = vi.fn().mockImplementationOnce(first).mockResolvedValueOnce(response([]));
      expect(await (await fetchArchive(api, {}, { fetch })).json()).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });

  it("does not replace legitimate empty search results with Kemono results", async () => {
    const fetch = vi.fn().mockResolvedValue(response([]));
    await fetchArchive(api, {}, { fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("routes source-specific media to the assigned server with /data exactly once", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("image"));
    await fetchArchive("https://kemono.cr/__pawchive/n3.pawchive.pw/data/hash.png", {}, { fetch });
    expect(String(fetch.mock.calls[0][0])).toBe("https://n3.pawchive.pw/data/hash.png");
  });

  it("rejects arbitrary media hosts", async () => {
    const fetch = vi.fn();
    await expect(fetchArchive("https://kemono.cr/__pawchive/evil.example/data/a", {}, { fetch })).rejects.toThrow("Invalid media host");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back for icons", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({}, 404)).mockResolvedValueOnce(new Response("icon"));
    await fetchArchive("https://kemono.cr/icons/patreon/123", {}, { fetch });
    expect(String(fetch.mock.calls[1][0])).toBe("https://img.kemono.cr/icons/patreon/123");
  });

  it("normalizes JSON, PostgreSQL and empty tags", () => {
    expect(normalizeTags('["Novel"]')).toEqual(["Novel"]);
    expect(normalizeTags("{}")).toEqual([]);
    expect(normalizeTags(["Novel"])).toEqual(["Novel"]);
  });

  it("falls back after a Pawchive timeout", async () => {
    const fetch = vi.fn().mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")));
    })).mockResolvedValueOnce(response([]));
    expect(await (await fetchArchive(api, {}, { fetch, timeoutMs: 5 })).json()).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the client cancels", async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException("cancelled", "AbortError");
    });
    await expect(fetchArchive(api, { signal: controller.signal }, { fetch })).rejects.toThrow("cancelled");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves Kemono's legacy file servers", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response([{ file: { path: "/hash.png", server: "https://n4.kemono.su" } }]));
    const [post] = await (await fetchArchive(api, {}, { fetch })).json();
    expect(post.file.original).toBe("https://n4.kemono.su/data/hash.png");
    fetch.mockResolvedValueOnce(new Response("image"));
    await fetchArchive(`https://kemono.cr${post.file.path}`, {}, { fetch });
    expect(String(fetch.mock.calls[2][0])).toBe("https://n4.kemono.su/data/hash.png");
  });
});
