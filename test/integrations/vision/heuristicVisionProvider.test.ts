import { describe, expect, it } from "vitest";
import { HeuristicVisionProvider } from "../../../src/integrations/vision/heuristicVisionProvider";

describe("HeuristicVisionProvider", () => {
  const provider = new HeuristicVisionProvider();

  it("removes an item by instruction", async () => {
    const rows = [
      { item: "Coffee", amount: 4.5, category: "Food" },
      { item: "Bus", amount: 1.2, category: "Transport" }
    ];
    const edited = await provider.applyEditInstruction(rows, "remove item 1");
    expect(edited).toEqual([{ item: "Bus", amount: 1.2, category: "Transport" }]);
  });

  it("updates amount by instruction", async () => {
    const rows = [{ item: "Coffee", amount: 4.5, category: "Food" }];
    const edited = await provider.applyEditInstruction(rows, "for item 1, set amount to: 9.90");
    expect(edited[0].amount).toBe(9.9);
  });

  it("updates category by instruction", async () => {
    const rows = [{ item: "Coffee", amount: 4.5, category: "Food" }];
    const edited = await provider.applyEditInstruction(rows, "for item 1, set category to: Lifestyle");
    expect(edited[0].category).toBe("Lifestyle");
  });

  it("updates remarks by instruction", async () => {
    const rows = [{ item: "Coffee", amount: 4.5, category: "Food" }];
    const edited = await provider.applyEditInstruction(rows, "for item 1, set remarks to: team lunch");
    expect(edited[0].remarks).toBe("team lunch");
  });

  it("returns [] for unknown instruction (signals fall-through to Hermes)", async () => {
    const rows = [{ item: "Coffee", amount: 4.5, category: "Food" }];
    const edited = await provider.applyEditInstruction(rows, "make it nice");
    expect(edited).toEqual([]);
  });

  it("bulk-updates category for multiple items", async () => {
    const rows = [
      { item: "Coffee", amount: 4.5, category: "Food" },
      { item: "Bus", amount: 1.2, category: "Transport" },
      { item: "Book", amount: 9.9, category: "Education" },
    ];
    const edited = await provider.applyEditInstruction(rows, "update items 1, 3 to Lifestyle");
    expect(edited[0].category).toBe("Lifestyle");
    expect(edited[1].category).toBe("Transport"); // unchanged
    expect(edited[2].category).toBe("Lifestyle");
  });

  it("bulk-updates category with 'items X to Y category' phrasing", async () => {
    const rows = [
      { item: "Coffee", amount: 4.5, category: "Food" },
      { item: "Bus", amount: 1.2, category: "Transport" },
    ];
    const edited = await provider.applyEditInstruction(rows, "items 1, 2 to Food category");
    expect(edited[0].category).toBe("Food");
    expect(edited[1].category).toBe("Food");
  });

  it("bulk-updates amount for multiple items", async () => {
    const rows = [
      { item: "Coffee", amount: 4.5, category: "Food" },
      { item: "Bus", amount: 1.2, category: "Transport" },
      { item: "Book", amount: 9.9, category: "Education" }
    ];
    const edited = await provider.applyEditInstruction(rows, "set items 1, 3 amount to 7.25");
    expect(edited[0].amount).toBe(7.25);
    expect(edited[1].amount).toBe(1.2);
    expect(edited[2].amount).toBe(7.25);
  });

  it("treats bare text value as category in bulk updates", async () => {
    const rows = [
      { item: "Coffee", amount: -4.5, category: "Food" },
      { item: "Bus", amount: -1.2, category: "Transport" }
    ];
    const edited = await provider.applyEditInstruction(rows, "update items 1, 2 to income");
    expect(edited[0].category).toBe("income");
    expect(edited[1].category).toBe("income");
    expect(edited[0].amount).toBe(-4.5);
    expect(edited[1].amount).toBe(-1.2);
  });

  it("returns [] for unsupported single-item type edit", async () => {
    const rows = [{ item: "Coffee", amount: 4.5, category: "Food" }];
    const edited = await provider.applyEditInstruction(rows, "for item 1, set type to: expense");
    expect(edited).toEqual([]);
  });
});
