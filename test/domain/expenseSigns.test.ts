import { describe, expect, it } from "vitest";
import { normalizeRowAmount, normalizeRows, parseAmount } from "../../src/domain/expenseSigns";

describe("expenseSigns", () => {
  it("keeps expense amount positive", () => {
    expect(normalizeRowAmount({ item: "Coffee", amount: "4.50", category: "Food" }).amount).toBe(4.5);
  });

  it("marks refund-like rows as negative", () => {
    expect(normalizeRowAmount({ item: "Shopee refund", amount: "12.34", category: "Lifestyle" }).amount).toBe(-12.34);
  });

  it("respects explicit income type", () => {
    expect(normalizeRowAmount({ item: "split", amount: "15", type: "income" }).amount).toBe(-15);
  });

  it("respects explicit expense type", () => {
    expect(normalizeRowAmount({ item: "Refundable deposit", amount: "15", type: "expense" }).amount).toBe(15);
  });

  it("normalizes multiple rows", () => {
    const out = normalizeRows([
      { item: "Lunch", amount: "10.00" },
      { item: "Grab refund", amount: "3.20" }
    ]);
    expect(out[0].amount).toBe(10);
    expect(out[1].amount).toBe(-3.2);
  });

  it("parses amounts with symbols", () => {
    expect(parseAmount("$1,234.50")).toBe(1234.5);
  });
});
