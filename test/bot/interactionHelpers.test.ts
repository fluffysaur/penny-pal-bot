import { describe, expect, it, vi } from "vitest";
import {
  categoryChoiceKeyboard,
  pickTypedCategory,
  renderItemEditText,
  sendOrEditMessage
} from "../../src/bot/interactionHelpers";

describe("interactionHelpers", () => {
  it("prefers editing the same message when requested", async () => {
    const reply = vi.fn(async () => ({}));
    const editMessageText = vi.fn(async () => ({}));

    await sendOrEditMessage({ reply, editMessageText }, "Hello", undefined, true);

    expect(editMessageText).toHaveBeenCalledTimes(1);
    expect(reply).not.toHaveBeenCalled();
  });

  it("falls back to reply when edit is unavailable", async () => {
    const reply = vi.fn(async () => ({}));

    await sendOrEditMessage({ reply }, "Hello", undefined, true);

    expect(reply).toHaveBeenCalledTimes(1);
  });

  it("renders item editor text with current field values", () => {
    const text = renderItemEditText("Yi Jia", 1, {
      item: "Salary",
      amount: 2500,
      category: "Income",
      date: "2026-05-19",
      remarks: "May payout"
    });

    expect(text).toContain("Editing <b>Yi Jia</b> item 2");
    expect(text).toContain("<b>Item</b>: Salary");
    expect(text).toContain("<b>Amount</b>: 2500.00");
    expect(text).toContain("<b>Type</b>: income");
  });

  it("picks category using normalized matching", () => {
    const picked = pickTypedCategory("food drinks", ["Transport", "Food & Drinks"]);
    expect(picked).toBe("Food & Drinks");
  });

  it("builds category keyboard callbacks", () => {
    const keyboard = categoryChoiceKeyboard(2, ["Food"], false, false);
    const inline = (keyboard as any).reply_markup?.inline_keyboard;
    expect(inline[0][0].callback_data).toBe("category_pick:2:food");
    expect(inline[1][0].callback_data).toBe("cancel");
  });
});
