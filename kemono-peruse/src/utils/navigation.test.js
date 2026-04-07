import {
  buildHistoryState,
  decodePathSegment,
  ensureView,
  getInitialView,
  getTitleForView,
  getUrlForView,
  getViewFromHistoryState,
  normalizeBasePath,
  viewsEqual,
} from "./navigation.js";

describe("navigation utils", () => {
  it("normalizeBasePath keeps one leading/trailing slash", () => {
    expect(normalizeBasePath("app")).toBe("/app/");
    expect(normalizeBasePath("/app")).toBe("/app/");
    expect(normalizeBasePath("/app//")).toBe("/app/");
    expect(normalizeBasePath("")).toBe("/");
  });

  it("ensureView returns home for invalid input", () => {
    expect(ensureView(null)).toEqual({ name: "home" });
    expect(ensureView({ name: "invalid" })).toEqual({ name: "home" });
  });

  it("parses creator and post views from path/search", () => {
    const creator = getViewFromHistoryState(null, "/creator/patreon/50049787", "?pos=50");
    const post = getViewFromHistoryState(null, "/creator/patreon/50049787/post/148264629", "?pos=100");

    expect(creator).toMatchObject({
      name: "creator",
      service: "patreon",
      creatorId: "50049787",
      position: 50,
    });
    expect(post).toMatchObject({
      name: "post",
      service: "patreon",
      creatorId: "50049787",
      postId: "148264629",
      position: 100,
    });
  });

  it("prefers history state view when present", () => {
    const state = buildHistoryState({ name: "home" });
    const view = getViewFromHistoryState(state, "/creator/patreon/50049787");
    expect(view).toEqual({ name: "home" });
  });

  it("builds creator urls with pos and omits pos from post urls", () => {
    const creatorUrl = getUrlForView({
      name: "creator",
      service: "patreon",
      creatorId: "50049787",
      position: 25,
    });
    const postUrl = getUrlForView({
      name: "post",
      service: "patreon",
      creatorId: "50049787",
      postId: "148264629",
      position: 75,
    });

    expect(creatorUrl).toContain("/creator/patreon/50049787");
    expect(creatorUrl).toContain("pos=25");
    expect(postUrl).toContain("/creator/patreon/50049787/post/148264629");
    expect(postUrl).not.toContain("pos=75");
  });

  it("compares views correctly", () => {
    expect(viewsEqual({ name: "home" }, { name: "home" })).toBe(true);
    expect(
      viewsEqual(
        { name: "creator", service: "patreon", creatorId: "1", creatorName: "", position: 0 },
        { name: "creator", service: "patreon", creatorId: "2", creatorName: "", position: 0 },
      ),
    ).toBe(false);
    expect(
      viewsEqual(
        {
          name: "post",
          service: "patreon",
          creatorId: "1",
          creatorName: "A",
          postId: "99",
          position: 5,
        },
        {
          name: "post",
          service: "patreon",
          creatorId: "1",
          creatorName: "A",
          postId: "99",
          position: 8,
        },
      ),
    ).toBe(false);
  });

  it("builds readable titles", () => {
    const creatorTitle = getTitleForView({
      name: "creator",
      service: "patreon",
      creatorId: "50049787",
      creatorName: "AYEH",
    });
    const postTitle = getTitleForView({
      name: "post",
      service: "patreon",
      creatorId: "50049787",
      creatorName: "AYEH",
      postId: "148264629",
      postTitle: "Confidence is Apotheosis",
    });

    expect(creatorTitle).toContain("AYEH");
    expect(creatorTitle).toContain("Patreon");
    expect(postTitle).toContain("Confidence is Apotheosis");
  });

  it("decodes path segments safely", () => {
    expect(decodePathSegment("AYEH%20art")).toBe("AYEH art");
    expect(decodePathSegment("%E0%A4%A")).toBe("%E0%A4%A");
  });

  it("builds encoded urls and omits non-positive pos query", () => {
    const encoded = getUrlForView({
      name: "post",
      service: "patreon",
      creatorId: "creator id",
      postId: "post/id",
      position: 0,
    });
    expect(encoded).toContain("/creator/patreon/creator%20id/post/post%2Fid");
    expect(encoded).not.toContain("pos=");
  });

  it("getInitialView prefers history state and falls back to location parsing", () => {
    window.history.replaceState(
      {
        view: {
          name: "creator",
          service: "fanbox",
          creatorId: "1234",
          creatorName: "Alpha",
        },
      },
      "",
      "/",
    );
    expect(getInitialView()).toMatchObject({
      name: "creator",
      service: "fanbox",
      creatorId: "1234",
      creatorName: "Alpha",
    });

    window.history.replaceState(null, "", "/creator/fanbox/abc%20123/post/p%2Fid?pos=7");
    expect(getInitialView()).toMatchObject({
      name: "post",
      service: "fanbox",
      creatorId: "abc 123",
      postId: "p/id",
      position: 7,
    });
  });
});
