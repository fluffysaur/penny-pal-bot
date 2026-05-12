import type { ExpenseRow } from "../../types";
import type { VisionProvider } from "./provider";

export class CompositeVisionProvider implements VisionProvider {
  constructor(private readonly providers: VisionProvider[]) {}

  public async parseImage(imagePath: string): Promise<ExpenseRow[]> {
    for (const provider of this.providers) {
      const rows = await provider.parseImage(imagePath);
      if (rows.length > 0) {
        return rows;
      }
    }
    return [];
  }

  public async applyEditInstruction(rows: ExpenseRow[], instruction: string): Promise<ExpenseRow[]> {
    for (const provider of this.providers) {
      const edited = await provider.applyEditInstruction(rows, instruction);
      if (edited.length > 0) {
        return edited;
      }
    }
    return rows;
  }
}
