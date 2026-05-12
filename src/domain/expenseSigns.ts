import type { ExpenseRow } from "../types";

const INCOME_KEYWORDS = [
  "refund",
  "refunded",
  "reversal",
  "reversed",
  "cashback",
  "rebate",
  "returned",
  "return",
  "payback",
  "paid me back",
  "pay me back",
  "reimburs",
  "reimbursement",
  "income",
  "credit back",
  "credited back",
  "received from"
];

export function parseAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value.replace(/,/g, "").replace(/[^0-9.-]+/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function rowLooksLikeIncome(row: ExpenseRow): boolean {
  const rowType = String(row.type ?? "").toLowerCase().trim();
  if (rowType === "income") {
    return true;
  }
  if (rowType === "expense") {
    return false;
  }

  const combined = [row.item, row.category, row.remarks, row.type]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return INCOME_KEYWORDS.some((kw) => combined.includes(kw));
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
    amount: isIncome ? -abs : abs
  };
}

export function normalizeRows(rows: ExpenseRow[]): ExpenseRow[] {
  return rows.map((row) => normalizeRowAmount(row));
}
