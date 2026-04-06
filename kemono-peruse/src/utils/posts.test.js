import {
  escapeHtml,
  extractTagTokens,
  getPostExcerptHtml,
  getServiceLabel,
  normalizePostHtml,
  toNumericCount,
} from "./posts.js";

describe("posts utils", () => {
  it("extractTagTokens normalizes comma-separated tokens", () => {
    expect(extractTagTokens(" AYEH,  MGMH , , Test ")).toEqual(["ayeh", "mgmh", "test"]);
  });

  it("toNumericCount parses numbers from multiple input types", () => {
    expect(toNumericCount(42)).toBe(42);
    expect(toNumericCount(42n)).toBe(42);
    expect(toNumericCount("1,234 posts")).toBe(1234);
    expect(toNumericCount("no digits")).toBeNull();
  });

  it("escapeHtml escapes html-sensitive characters", () => {
    expect(escapeHtml(`<a href="x">'&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;");
  });

  it("getPostExcerptHtml returns sanitized excerpt text", () => {
    const excerpt = getPostExcerptHtml({
      content: "<p>Hello <strong>world</strong> & friends</p>",
    });

    expect(excerpt).toBe("Hello world &amp; friends");
  });

  it("getPostExcerptHtml handles structured excerpts and truncates long text", () => {
    const longChunk = "x".repeat(300);
    const excerpt = getPostExcerptHtml({
      excerpt: { en: `<p>${longChunk}</p>` },
    });

    expect(excerpt?.length).toBeLessThanOrEqual(243);
    expect(excerpt).toMatch(/\.\.\.$/);
  });

  it("getPostExcerptHtml returns null when candidates are empty after sanitizing", () => {
    expect(getPostExcerptHtml({ body: "<p><br/></p>" })).toBeNull();
  });

  it("normalizePostHtml rewrites relative src urls", () => {
    const html = `<img src="/data/file.jpg" alt="x" />`;
    const normalized = normalizePostHtml(html);
    expect(normalized).toContain(`src="https://kemono.cr/data/file.jpg"`);
  });

  it("normalizePostHtml converts Fanbox download anchors into inline images", () => {
    const html = `<p><a href="https://downloads.fanbox.cc/files/post/abc/MyImage.png">file</a></p>`;
    const normalized = normalizePostHtml(html, {
      service: "fanbox",
      mediaBase: "https://media.example",
      attachments: [{ name: "MyImage.png", path: "/uploads/my-image.png" }],
    });

    expect(normalized).toContain("<img");
    expect(normalized).toContain(`src="https://media.example/uploads/my-image.png"`);
    expect(normalized).not.toContain("downloads.fanbox.cc");
  });

  it("normalizePostHtml leaves fanbox anchors when no matching attachment exists", () => {
    const html = `<a href="https://downloads.fanbox.cc/files/post/abc/missing.png">file</a>`;
    const normalized = normalizePostHtml(html, {
      service: "fanbox",
      mediaBase: "https://media.example",
      attachments: [{ name: "other.png", path: "/uploads/other.png" }],
    });

    expect(normalized).toContain("downloads.fanbox.cc");
    expect(normalized).not.toContain("<img");
  });

  it("normalizePostHtml recovers when DOM parsing fails", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const originalParser = window.DOMParser;
    class ThrowingDomParser {
      parseFromString() {
        throw new Error("broken parser");
      }
    }
    window.DOMParser = ThrowingDomParser;

    try {
      const html = `<img src="/data/file.jpg" alt="x" />`;
      const normalized = normalizePostHtml(html, {
        service: "fanbox",
        mediaBase: "https://media.example",
        attachments: [{ name: "file.jpg", path: "/uploads/file.jpg" }],
      });

      expect(normalized).toContain(`src="https://kemono.cr/data/file.jpg"`);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      window.DOMParser = originalParser;
    }
  });

  it("getServiceLabel returns known mapping and title-cases unknown service", () => {
    expect(getServiceLabel("patreon")).toBe("Patreon");
    expect(getServiceLabel("unknown-service")).toBe("Unknown-service");
  });
});
