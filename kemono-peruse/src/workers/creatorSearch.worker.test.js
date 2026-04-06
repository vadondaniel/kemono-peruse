describe("creatorSearch.worker", () => {
  beforeEach(() => {
    vi.resetModules();
    self.onmessage = null;
    self.postMessage = vi.fn();
  });

  it("ignores malformed payloads and unknown message types", async () => {
    await import("./creatorSearch.worker.js");
    self.onmessage({ data: null });
    self.onmessage({ data: { type: "unknown" } });
    expect(self.postMessage).not.toHaveBeenCalled();
  });

  it("stores directory and returns search results", async () => {
    await import("./creatorSearch.worker.js");

    self.onmessage({
      data: {
        type: "setDirectory",
        directory: [
          {
            id: "50049787",
            idLower: "50049787",
            service: "patreon",
            name: "AYEH",
            nameLower: "ayeh",
            favorited: 10,
            indexed: 1700,
            updated: 1800,
          },
          {
            id: "1234",
            idLower: "1234",
            service: "fanbox",
            name: "Alpha",
            nameLower: "alpha",
            favorited: 2,
            indexed: 1000,
            updated: 1100,
          },
        ],
      },
    });

    self.onmessage({
      data: {
        type: "search",
        requestId: 7,
        serviceFilter: "patreon",
        tokens: ["AY"],
        limit: 30,
      },
    });

    expect(self.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "searchResult",
        requestId: 7,
        total: 1,
      }),
    );
    const payload = self.postMessage.mock.calls[0][0];
    expect(payload.results[0].id).toBe("50049787");
  });

  it("defaults requestId and service filter safely when payload is partial", async () => {
    await import("./creatorSearch.worker.js");

    self.onmessage({
      data: {
        type: "setDirectory",
        directory: [
          {
            id: "1234",
            idLower: "1234",
            service: "fanbox",
            name: "Alpha",
            nameLower: "alpha",
            favorited: 1,
            indexed: 1,
            updated: 1,
          },
        ],
      },
    });

    self.onmessage({
      data: {
        type: "search",
        tokens: ["a"],
        limit: 1,
      },
    });

    expect(self.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 0,
        total: 1,
      }),
    );
  });
});
