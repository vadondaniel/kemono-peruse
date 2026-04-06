import { formatDate } from "./date.js";

describe("date utils", () => {
  it("returns placeholders for empty timestamp", () => {
    expect(formatDate(null)).toEqual({ date: "-", time: "" });
  });

  it("formats valid timestamp into date/time parts", () => {
    const result = formatDate("2025-01-01T10:30:00.000Z");
    expect(typeof result.date).toBe("string");
    expect(result.date.length).toBeGreaterThan(0);
    expect(typeof result.time).toBe("string");
    expect(result.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it("falls back to raw string when formatter throws", () => {
    const formatterSpy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("intl unavailable");
    });

    expect(formatDate("2025-01-01T10:30:00.000Z")).toEqual({
      date: "2025-01-01T10:30:00.000Z",
      time: "",
    });
    expect(formatDate(123)).toEqual({ date: "-", time: "" });

    formatterSpy.mockRestore();
  });
});
