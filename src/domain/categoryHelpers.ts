import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExpenseRow, ParsedCategoryIssue } from "../types";

const CATEGORY_ALIASES: Record<string, string> = {
  transport: "Transport",
  bus: "Transport",
  mrt: "Transport",
  grab: "Transport",
  taxi: "Transport",
  train: "Transport",
  food: "Food",
  grocer: "Food",
  shopping: "Lifestyle",
  lifestyle: "Lifestyle",
  software: "Lifestyle",
  subscription: "Lifestyle",
  invest: "Investments",
  goal: "Goals",
  saving: "Savings",
  tith: "Tithing",
  buffer: "Buffer"
};

const memoryFile = resolve(process.cwd(), "state", "category_learning.json");

export function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function loadLearnedMap(): Record<string, string> {
  try {
    const raw = readFileSync(memoryFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

export function rememberCategoryMapping(rawCategory: string, selectedCategory: string): void {
  const current = loadLearnedMap();
  current[normalizeKey(rawCategory)] = selectedCategory;
  mkdirSync(resolve(process.cwd(), "state"), { recursive: true });
  writeFileSync(memoryFile, JSON.stringify(current, null, 2));
}

export function resolveCategory(rawCategory: string | undefined, options: string[], learnedMap = loadLearnedMap()): string | null {
  if (!rawCategory) {
    return null;
  }

  const key = normalizeKey(rawCategory);
  const optionMap = new Map(options.map((option) => [normalizeKey(option), option]));
  if (optionMap.has(key)) {
    return optionMap.get(key) ?? null;
  }

  const learned = learnedMap[key];
  if (learned && optionMap.has(normalizeKey(learned))) {
    return optionMap.get(normalizeKey(learned)) ?? null;
  }

  const lower = rawCategory.toLowerCase();
  for (const [needle, canonical] of Object.entries(CATEGORY_ALIASES)) {
    if (lower.includes(needle) && optionMap.has(normalizeKey(canonical))) {
      return optionMap.get(normalizeKey(canonical)) ?? null;
    }
  }

  return null;
}

export function findAmbiguousCategories(rows: ExpenseRow[], options: string[]): ParsedCategoryIssue[] {
  const known = new Set(options.map((o) => normalizeKey(o)));
  const learnedMap = loadLearnedMap();
  const out: ParsedCategoryIssue[] = [];

  rows.forEach((row, index) => {
    const raw = String(row.category ?? "").trim();
    const key = normalizeKey(raw);
    if (!raw || !key || (!known.has(key) && !resolveCategory(raw, options, learnedMap))) {
      out.push({ index, rawCategory: raw || "(missing category)" });
    }
  });

  return out;
}

export function normalizeRowsCategories(rows: ExpenseRow[], options: string[]): ExpenseRow[] {
  const learned = loadLearnedMap();
  return rows.map((row) => {
    const resolved = resolveCategory(row.category, options, learned);
    if (!resolved) {
      return { ...row };
    }
    return {
      ...row,
      category: resolved
    };
  });
}

export function buildCategoryClarificationText(rows: ExpenseRow[], ambiguous: ParsedCategoryIssue[], currentPos = 0): string {
  const safePos = ambiguous.length === 0 ? 0 : Math.max(0, Math.min(currentPos, ambiguous.length - 1));
  const lines: string[] = [
    "I need your help with a few categories before I show the final list:",
    `Question ${safePos + 1} of ${ambiguous.length}`,
    ""
  ];

  for (const item of ambiguous) {
    const idx = item.index;
    const row = rows[idx];
    const name = row?.item || `item ${idx + 1}`;
    lines.push(`${idx + 1}. ${name} - detected label: ${item.rawCategory} (not in allowed categories)`);
  }

  if (ambiguous.length > 0) {
    lines.push("");
    lines.push(`Let's fix them one by one, currently on item ${ambiguous[safePos].index + 1}.`);
    lines.push("Choose a category below, or type one in text. I will remember it for next time.");
  }

  return lines.join("\n");
}
