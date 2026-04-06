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

  it("getServiceLabel returns known mapping and title-cases unknown service", () => {
    expect(getServiceLabel("patreon")).toBe("Patreon");
    expect(getServiceLabel("unknown-service")).toBe("Unknown-service");
  });
});
