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

  it("returns original rows for unknown instruction", async () => {
    const rows = [{ item: "Coffee", amount: 4.5, category: "Food" }];
    const edited = await provider.applyEditInstruction(rows, "make it nice");
    expect(edited).toEqual(rows);
  });
});
