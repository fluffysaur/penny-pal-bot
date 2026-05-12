import type { ExpenseRow } from "../../types";

export interface VisionProvider {
  parseImage(imagePath: string): Promise<ExpenseRow[]>;
  applyEditInstruction(rows: ExpenseRow[], instruction: string): Promise<ExpenseRow[]>;
}
