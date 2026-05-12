import type { ExpenseRow } from "../types";

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function parseManualEntries(input: string): ExpenseRow[] {
  const rows: ExpenseRow[] = [];

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.includes("|")) {
      const parts = line.split("|").map((part) => part.trim());
      if (parts.length < 3) {
        throw new Error("Each manual entry must include at least item, amount, and category.");
      }
      const item = parts[0];
      const amount = Number(parts[1].replace(/,/g, ""));
      if (!Number.isFinite(amount)) {
        throw new Error(`Invalid amount: ${parts[1]}`);
      }
      const date = parts[3] ? parts[3] : todayIso();
      const remarks = parts.length >= 5 ? parts.slice(4).join("|").trim() : "";
      rows.push({ item, amount, category: parts[2], date, remarks });
      continue;
    }

    const tokens = line.split(/\s+/);
    if (tokens.length < 3) {
      throw new Error("Each manual entry must include at least item, amount, and category.");
    }

    const amountIdx = tokens.findIndex((token) => Number.isFinite(Number(token.replace(/,/g, ""))));
    if (amountIdx <= 0 || amountIdx >= tokens.length - 1) {
      throw new Error("Simple manual format should look like: Coffee 4.50 Food");
    }

    const item = tokens.slice(0, amountIdx).join(" ");
    const amount = Number(tokens[amountIdx].replace(/,/g, ""));
    if (!Number.isFinite(amount)) {
      throw new Error(`Invalid amount: ${tokens[amountIdx]}`);
    }
    const category = tokens[amountIdx + 1];
    const remainder = tokens.slice(amountIdx + 2);

    let date = todayIso();
    let remarks = "";
    if (remainder.length > 0) {
      if (isIsoDate(remainder[0])) {
        date = remainder[0];
        remarks = remainder.slice(1).join(" ").trim();
      } else {
        remarks = remainder.join(" ").trim();
      }
    }

    rows.push({ item, amount, category, date, remarks });
  }

  if (rows.length === 0) {
    throw new Error("No manual entries found.");
  }

  return rows;
}
