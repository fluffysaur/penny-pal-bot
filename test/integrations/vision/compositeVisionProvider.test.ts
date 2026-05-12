import { afterEach, describe, expect, it, vi } from "vitest";
import { CompositeVisionProvider } from "../../../src/integrations/vision/compositeVisionProvider";
import type { VisionProvider } from "../../../src/integrations/vision/provider";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CompositeVisionProvider", () => {
  it("falls back when first provider throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing: VisionProvider = {
      parseImage: async () => {
        throw new Error("fail");
      },
      applyEditInstruction: async (rows) => rows
    };

    const succeeding: VisionProvider = {
      parseImage: async () => [{ item: "Coffee", amount: 4.5, category: "Food" }],
      applyEditInstruction: async (rows) => rows
    };

    const provider = new CompositeVisionProvider([failing, succeeding]);
    const rows = await provider.parseImage("/tmp/fake.jpg");
    expect(rows).toHaveLength(1);
    expect(rows[0].item).toBe("Coffee");
  });

  it("throws when every provider fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing: VisionProvider = {
      parseImage: async () => {
        throw new Error("all failed");
      },
      applyEditInstruction: async (rows) => rows
    };

    const provider = new CompositeVisionProvider([failing]);
    await expect(provider.parseImage("/tmp/fake.jpg")).rejects.toThrow("all failed");
  });
});
