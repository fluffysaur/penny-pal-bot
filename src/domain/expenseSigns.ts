import type { ExpenseRow } from "../types";

export function parseAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }

  let normalized = value.trim().replace(/[−﹣－–—]/g, "-");
  if (/^\(.*\)$/.test(normalized)) {
    normalized = `-${normalized.slice(1, -1)}`;
  } else if (/.*-$/.test(normalized) && !normalized.startsWith("-")) {
    normalized = `-${normalized.slice(0, -1)}`;
  }

  const cleaned = normalized.replace(/,/g, "").replace(/[^0-9.-]+/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function rowLooksLikeIncome(row: ExpenseRow): boolean {
  const parsedAmount = parseAmount(row.amount);
  if (parsedAmount !== null) {
    return parsedAmount > 0;
  }

  return String(row.type ?? "").toLowerCase().trim() === "income";
}

export function normalizeRowAmount(row: ExpenseRow): ExpenseRow {
  const amount = parseAmount(row.amount);
  if (amount === null) {
    return { ...row };
  }

  const isIncome = rowLooksLikeIncome(row);
  const abs = Math.abs(amount);
  return {
    ...row,
    amount: isIncome ? abs : -abs
  };
}

export function normalizeRows(rows: ExpenseRow[]): ExpenseRow[] {
  return rows.map((row) => normalizeRowAmount(row));
}
