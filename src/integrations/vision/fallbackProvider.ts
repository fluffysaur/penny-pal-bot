import type { ExpenseRow } from "../../types";
import type { VisionProvider } from "./provider";

export class FallbackVisionProvider implements VisionProvider {
  public async parseImage(_imagePath: string): Promise<ExpenseRow[]> {
    return [];
  }

  public async applyEditInstruction(rows: ExpenseRow[], _instruction: string): Promise<ExpenseRow[]> {
    return rows;
  }
}
