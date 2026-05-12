import { describe, expect, it } from "vitest";
import {
  buildCategoryClarificationText,
  findAmbiguousCategories,
  normalizeRowsCategories,
  resolveCategory
} from "../../src/domain/categoryHelpers";

describe("categoryHelpers", () => {
  it("resolves software/subscription to Lifestyle when available", () => {
    const resolved = resolveCategory("Software/Subscription", ["Lifestyle", "Food"]);
    expect(resolved).toBe("Lifestyle");
  });

  it("normalizes rows categories with known aliases", () => {
    const normalized = normalizeRowsCategories(
      [{ item: "Claude", amount: 10, category: "subscription software" }],
      ["Lifestyle", "Food"]
    );
    expect(normalized[0].category).toBe("Lifestyle");
  });

  it("finds ambiguous categories", () => {
    const ambiguous = findAmbiguousCategories(
      [
        { item: "Coffee", amount: 4.5, category: "Food" },
        { item: "Unknown", amount: 5, category: "???" }
      ],
      ["Food", "Lifestyle"]
    );
    expect(ambiguous).toEqual([{ index: 1, rawCategory: "???" }]);
  });

  it("builds clarification text with position", () => {
    const text = buildCategoryClarificationText(
      [
        { item: "Coffee", amount: 4.5, category: "Food" },
        { item: "Unknown", amount: 5, category: "???" }
      ],
      [{ index: 1, rawCategory: "???" }],
      0
    );

    expect(text).toContain("Question 1 of 1");
    expect(text).toContain("Unknown - detected label: ???");
  });
});
