import { describe, expect, it } from "vitest";
import {
  appendManualEntries,
  applyFieldEdit,
  hasUnresolvedCategories,
  parseRemoveTarget,
  removeEntryAt
} from "../../src/bot/flowHelpers";

describe("flowHelpers", () => {
  it("applies amount field edit", () => {
    const result = applyFieldEdit(
      [{ item: "Coffee", amount: 4.5, category: "Food" }],
      0,
      "amount",
      "9.90"
    );
    expect(result.error).toBeUndefined();
    expect(result.rows[0].amount).toBe(9.9);
  });

  it("returns error for invalid amount", () => {
    const result = applyFieldEdit(
      [{ item: "Coffee", amount: 4.5, category: "Food" }],
      0,
      "amount",
      "not-a-number"
    );
    expect(result.error).toContain("Could not parse");
  });

  it("appends manual entries", () => {
    const result = appendManualEntries(
      [{ item: "Coffee", amount: 4.5, category: "Food", date: "2026-05-12" }],
      "Bus | 1.20 | Transport | 2026-05-12"
    );
    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1].item).toBe("Bus");
  });

  it("parses remove target from instruction and numeric shorthand", () => {
    expect(parseRemoveTarget("remove item 2")).toBe(1);
    expect(parseRemoveTarget("3")).toBe(2);
    expect(parseRemoveTarget("remove this")).toBeNull();
  });

  it("removes entry by index", () => {
    const result = removeEntryAt(
      [
        { item: "Coffee", amount: 4.5 },
        { item: "Bus", amount: 1.2 }
      ],
      0
    );
    expect(result.error).toBeUndefined();
    expect(result.rows).toEqual([{ item: "Bus", amount: 1.2 }]);
  });

  it("flags unresolved categories before approval", () => {
    const rows = [
      { item: "Coffee", amount: 4.5, category: "Food" },
      { item: "Mystery", amount: 10, category: "???" }
    ];
    expect(hasUnresolvedCategories(rows, ["Food", "Lifestyle"])).toBe(true);
    expect(hasUnresolvedCategories(rows, [])).toBe(false);
  });
});
