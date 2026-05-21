import { describe, expect, it } from "vitest";
import { removeItemKeyboard, renderPreviewText } from "../../src/bot/formatting";

describe("formatting", () => {
  it("builds remove-item keyboard with row callbacks", () => {
    const keyboard = removeItemKeyboard([
      { item: "Coffee", amount: 4.5 },
      { item: "Bus ride", amount: 1.2 }
    ]);

    const inline = (keyboard as any).reply_markup?.inline_keyboard;
    expect(Array.isArray(inline)).toBe(true);
    expect(inline[0][0].callback_data).toBe("remove_item:0");
    expect(inline[1][0].callback_data).toBe("remove_item:1");
    expect(inline[2][0].callback_data).toBe("edit_menu");
    expect(inline[3][0].callback_data).toBe("cancel");
  });

  it("tags positive amounts as income/refund in preview", () => {
    const text = renderPreviewText("Yi Jia", [
      { item: "Salary", amount: 2500, category: "Income", date: "2026-05-19" },
      { item: "Coffee", amount: -4.5, category: "Food", date: "2026-05-19" }
    ]);

    expect(text).toContain("Salary");
    expect(text).toContain("income/refund");
    expect(text).not.toContain("Coffee</b>\n   -4.50  ·  Food  ·  2026-05-19  ·  <i>income/refund</i>");
  });
});
