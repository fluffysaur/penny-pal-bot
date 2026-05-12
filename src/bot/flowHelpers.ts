import { findAmbiguousCategories } from "../domain/categoryHelpers";
import { parseAmount } from "../domain/expenseSigns";
import { parseManualEntries } from "../domain/manualParser";
import type { ExpenseRow } from "../types";
import type { EditableField } from "./sessionStore";

export function applyFieldEdit(
  rows: ExpenseRow[],
  itemIndex: number,
  field: EditableField,
  value: string,
  categoryOptions: string[] = []
): { rows: ExpenseRow[]; error?: string } {
  if (itemIndex < 0 || itemIndex >= rows.length) {
    return { rows, error: "That item no longer exists. Please reopen the edit menu." };
  }

  const updated = [...rows];
  const current = { ...updated[itemIndex] };

  if (field === "name") {
    current.item = value.trim();
  } else if (field === "amount") {
    const parsed = parseAmount(value);
    if (parsed === null) {
      return { rows, error: "Could not parse that amount. Try a numeric value like 39.05 or 39." };
    }
    current.amount = parsed;
  } else if (field === "category") {
    if (categoryOptions.length > 0) {
      const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const selected = categoryOptions.find(
        (option) => option.toLowerCase().replace(/[^a-z0-9]+/g, "") === normalized
      );
      if (!selected) {
        return { rows, error: "I could not match that to a current category. Type an exact category name." };
      }
      current.category = selected;
    } else {
      current.category = value.trim();
    }
  } else if (field === "date") {
    current.date = value.trim();
  } else if (field === "remarks") {
    current.remarks = value.trim();
  }

  updated[itemIndex] = current;
  return { rows: updated };
}

export function appendManualEntries(rows: ExpenseRow[], text: string): { rows: ExpenseRow[]; error?: string } {
  try {
    const additions = parseManualEntries(text);
    return { rows: [...rows, ...additions] };
  } catch (error) {
    return { rows, error: (error as Error).message };
  }
}

export function parseRemoveTarget(input: string): number | null {
  const text = input.trim();
  const removeMatch = text.match(/remove\s+item\s+(\d+)/i);
  if (removeMatch) {
    return Number(removeMatch[1]) - 1;
  }
  const numeric = Number(text);
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric - 1;
  }
  return null;
}

export function removeEntryAt(rows: ExpenseRow[], index: number): { rows: ExpenseRow[]; error?: string } {
  if (index < 0 || index >= rows.length) {
    return { rows, error: "Could not determine which item to remove. Try: remove item 2" };
  }
  return { rows: rows.filter((_, i) => i !== index) };
}

export function hasUnresolvedCategories(rows: ExpenseRow[], relationOptions: string[]): boolean {
  if (relationOptions.length === 0) {
    return false;
  }
  return findAmbiguousCategories(rows, relationOptions).length > 0;
}
