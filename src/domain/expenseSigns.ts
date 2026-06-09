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

export function normalizeRowAmount(row: ExpenseRow): ExpenseRow {
  const amount = parseAmount(row.amount);
  if (amount === null) {
    return { ...row };
  }

  const inverted = amount === 0 ? 0 : -amount;
  return {
    ...row,
    amount: inverted
  };
}

export function normalizeRows(rows: ExpenseRow[]): ExpenseRow[] {
  return rows.map((row) => normalizeRowAmount(row));
}
