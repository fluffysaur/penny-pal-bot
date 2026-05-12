import type { ExpenseRow } from "../../types";
import { parseAmount } from "../../domain/expenseSigns";
import type { VisionProvider } from "./provider";

function updateByIndex(rows: ExpenseRow[], oneBasedIndex: number, updater: (row: ExpenseRow) => ExpenseRow): ExpenseRow[] {
  const idx = oneBasedIndex - 1;
  if (idx < 0 || idx >= rows.length) {
    return rows;
  }
  return rows.map((row, i) => (i === idx ? updater(row) : row));
}

export class HeuristicVisionProvider implements VisionProvider {
  public async parseImage(_imagePath: string): Promise<ExpenseRow[]> {
    return [];
  }

  public async applyEditInstruction(rows: ExpenseRow[], instruction: string): Promise<ExpenseRow[]> {
    const text = instruction.trim();

    const removeMatch = text.match(/remove\s+item\s+(\d+)/i);
    if (removeMatch) {
      const idx = Number(removeMatch[1]) - 1;
      if (idx >= 0 && idx < rows.length) {
        return rows.filter((_, i) => i !== idx);
      }
      return rows;
    }

    const amountMatch = text.match(/item\s+(\d+).*amount\s+to\s*:?\s*([\-$0-9.,]+)/i);
    if (amountMatch) {
      const parsed = parseAmount(amountMatch[2]);
      if (parsed !== null) {
        return updateByIndex(rows, Number(amountMatch[1]), (row) => ({ ...row, amount: parsed }));
      }
    }

    const categoryMatch = text.match(/item\s+(\d+).*category\s+to\s*:?\s*(.+)$/i);
    if (categoryMatch) {
      return updateByIndex(rows, Number(categoryMatch[1]), (row) => ({ ...row, category: categoryMatch[2].trim() }));
    }

    const remarksMatch = text.match(/item\s+(\d+).*remarks\s+to\s*:?\s*(.+)$/i);
    if (remarksMatch) {
      return updateByIndex(rows, Number(remarksMatch[1]), (row) => ({ ...row, remarks: remarksMatch[2].trim() }));
    }

    return rows;
  }
}
