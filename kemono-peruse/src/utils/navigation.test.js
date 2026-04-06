import {
  buildHistoryState,
  ensureView,
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

  it("builds urls for creator and post views with pos", () => {
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
    expect(postUrl).toContain("pos=75");
  });

  it("compares views correctly", () => {
    expect(viewsEqual({ name: "home" }, { name: "home" })).toBe(true);
    expect(
      viewsEqual(
        { name: "creator", service: "patreon", creatorId: "1", creatorName: "", position: 0 },
        { name: "creator", service: "patreon", creatorId: "2", creatorName: "", position: 0 },
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
});
