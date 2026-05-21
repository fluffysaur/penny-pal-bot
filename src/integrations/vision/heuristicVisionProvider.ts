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

function parseIndexList(input: string): number[] {
  return input
    .split(/[\s,]+/)
    .map((value) => parseInt(value, 10))
    .filter((value) => !isNaN(value) && value > 0);
}

function applyTypeWithSign(row: ExpenseRow, type: "income" | "expense"): ExpenseRow {
  const parsed = parseAmount(row.amount);
  if (parsed === null) {
    return { ...row, type };
  }
  const abs = Math.abs(parsed);
  return { ...row, type, amount: type === "income" ? abs : -abs };
}

function applyBulkFieldUpdate(rows: ExpenseRow[], indices: number[], field: string | undefined, value: string): ExpenseRow[] | null {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  const resolvedField = field ?? ( /^(income|expense)$/i.test(normalizedValue) ? "type" : parseAmount(normalizedValue) !== null ? "amount" : "category");

  const updated = rows.map((row, i) => {
    if (!indices.includes(i + 1)) {
      return row;
    }

    switch (resolvedField) {
      case "amount": {
        const parsed = parseAmount(normalizedValue);
        return parsed === null ? row : { ...row, amount: parsed };
      }
      case "type": {
        const type = normalizedValue.toLowerCase() as "income" | "expense";
        return type === "income" || type === "expense" ? applyTypeWithSign(row, type) : row;
      }
      case "date":
        return { ...row, date: normalizedValue };
      case "remarks":
        return { ...row, remarks: normalizedValue };
      case "item":
      case "name":
        return { ...row, item: normalizedValue };
      case "category":
      default:
        return { ...row, category: normalizedValue };
    }
  });

  return updated.some((row, index) => row !== rows[index]) ? updated : null;
}

function isKnownEditInstruction(text: string): boolean {
  if (/remove\s+item\s+\d+/i.test(text)) {
    return true;
  }
  if (/item\s+\d+.*amount\s+to\s*:?\s*([\-$0-9.,]+)/i.test(text)) {
    return true;
  }
  if (/item\s+\d+.*(type|category|date|remarks|name|item)\s+to\s*:?\s*(.+)$/i.test(text)) {
    return true;
  }
  if (/(?:(?:update|set|change|move)\s+)?items?\s+[\d,\s]+?\s+(?:(?:amount|type|category|date|remarks|name|item)\s+)?to\s+.+$/i.test(text)) {
    return true;
  }
  return false;
}

export function recognizesEditInstruction(instruction: string): boolean {
  return isKnownEditInstruction(instruction.trim());
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

    const typeMatch = text.match(/item\s+(\d+).*type\s+to\s*:?\s*(income|expense)\s*$/i);
    if (typeMatch) {
      return updateByIndex(rows, Number(typeMatch[1]), (row) => applyTypeWithSign(row, typeMatch[2].toLowerCase() as "income" | "expense"));
    }

    const categoryMatch = text.match(/item\s+(\d+).*category\s+to\s*:?\s*(.+)$/i);
    if (categoryMatch) {
      return updateByIndex(rows, Number(categoryMatch[1]), (row) => ({ ...row, category: categoryMatch[2].trim() }));
    }

    const dateMatch = text.match(/item\s+(\d+).*(?:date|day)\s+to\s*:?\s*(.+)$/i);
    if (dateMatch) {
      return updateByIndex(rows, Number(dateMatch[1]), (row) => ({ ...row, date: dateMatch[2].trim() }));
    }

    const remarksMatch = text.match(/item\s+(\d+).*remarks\s+to\s*:?\s*(.+)$/i);
    if (remarksMatch) {
      return updateByIndex(rows, Number(remarksMatch[1]), (row) => ({ ...row, remarks: remarksMatch[2].trim() }));
    }

    const bulkMatch = text.match(
      /(?:(?:update|set|change|move)\s+)?items?\s+([\d,\s]+?)\s+(?:(amount|type|category|date|remarks|name|item)\s+)?to\s+(.+?)(?:\s+(amount|type|category|date|remarks|name|item))?\s*$/i
    );
    if (bulkMatch) {
      const indices = parseIndexList(bulkMatch[1]);
      const field = (bulkMatch[2] ?? bulkMatch[4])?.toLowerCase();
      const value = bulkMatch[3].trim();
      const updated = applyBulkFieldUpdate(rows, indices, field, value);
      if (updated) {
        if (updated.some((row, index) => row !== rows[index])) {
          return updated;
        }
      }
    }

    return [];
  }

  public recognizesEditInstruction(instruction: string): boolean {
    return isKnownEditInstruction(instruction.trim());
  }
}
