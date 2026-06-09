import type { ExpenseRow } from "../../types";

export interface VisionProvider {
  parseImage(imagePath: string): Promise<ExpenseRow[]>;
  parseImages(imagePaths: string[]): Promise<ExpenseRow[]>;
  applyEditInstruction(rows: ExpenseRow[], instruction: string): Promise<ExpenseRow[]>;
}

export async function parseImagesSequentially(
  provider: Pick<VisionProvider, "parseImage">,
  imagePaths: string[]
): Promise<ExpenseRow[]> {
  const results: ExpenseRow[] = [];
  for (const imagePath of imagePaths) {
    results.push(...await provider.parseImage(imagePath));
  }
  return results;
}
