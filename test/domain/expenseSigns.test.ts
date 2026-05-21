import { describe, expect, it } from "vitest";
import { normalizeRowAmount, normalizeRows, parseAmount } from "../../src/domain/expenseSigns";

describe("expenseSigns", () => {
  it("keeps expense amount negative", () => {
    expect(normalizeRowAmount({ item: "Coffee", amount: "-4.50", category: "Food" }).amount).toBe(-4.5);
  });

  it("marks refund-like rows as positive", () => {
    expect(normalizeRowAmount({ item: "Shopee refund", amount: "12.34", category: "Lifestyle" }).amount).toBe(12.34);
  });

  it("keeps a negative signed amount as expense even when type says income", () => {
    expect(normalizeRowAmount({ item: "split", amount: "-15", type: "income" }).amount).toBe(-15);
  });

  it("keeps a positive signed amount as income even when type says expense", () => {
    expect(normalizeRowAmount({ item: "Refundable deposit", amount: "15", type: "expense" }).amount).toBe(15);
  });

  it("keeps positive amounts as income when type is unset", () => {
    expect(normalizeRowAmount({ item: "PayNow transfer", amount: 42 }).amount).toBe(42);
  });

  it("keeps a positive signed amount positive regardless of explicit expense type", () => {
    expect(normalizeRowAmount({ item: "Adjustment", amount: 7.5, type: "expense" }).amount).toBe(7.5);
  });

  it("normalizes multiple rows", () => {
    const out = normalizeRows([
      { item: "Lunch", amount: "-10.00" },
      { item: "Grab refund", amount: "3.20" }
    ]);
    expect(out[0].amount).toBe(-10);
    expect(out[1].amount).toBe(3.2);
  });

  it("parses amounts with symbols", () => {
    expect(parseAmount("$1,234.50")).toBe(1234.5);
  });

  it("parses unicode minus and parentheses as negative", () => {
    expect(parseAmount("−12.34")).toBe(-12.34);
    expect(parseAmount("(8.80)")).toBe(-8.8);
  });
});
