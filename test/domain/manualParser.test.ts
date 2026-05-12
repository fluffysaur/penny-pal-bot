import { describe, expect, it } from "vitest";
import { parseManualEntries } from "../../src/domain/manualParser";

describe("manualParser", () => {
  it("parses pipe format entries", () => {
    const rows = parseManualEntries("Coffee | 4.50 | Food | 2026-05-04 | team lunch");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      item: "Coffee",
      amount: 4.5,
      category: "Food",
      date: "2026-05-04",
      remarks: "team lunch"
    });
  });

  it("parses simple space-separated format", () => {
    const rows = parseManualEntries("Bubble Tea 6.80 Food");
    expect(rows[0].item).toBe("Bubble Tea");
    expect(rows[0].amount).toBe(6.8);
    expect(rows[0].category).toBe("Food");
  });

  it("throws on empty input", () => {
    expect(() => parseManualEntries("   \n\n")).toThrow("No manual entries found.");
  });
});
