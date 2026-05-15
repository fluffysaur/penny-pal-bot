import { normalizeRows, parseAmount } from "../../domain/expenseSigns";
import type { ExpenseRow } from "../../types";
import { NotionClient } from "./notionClient";

interface NotionPage {
  id: string;
  properties?: Record<string, unknown>;
}

interface PropertyNames {
  title?: string;
  amount?: string;
  date?: string;
  category?: string;
  remarks?: string;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function extractTitleFromPage(page: NotionPage): string {
  const properties = page.properties ?? {};
  for (const prop of Object.values(properties)) {
    if (!prop || typeof prop !== "object") {
      continue;
    }
    const typed = prop as Record<string, unknown>;
    if (typed.type !== "title" || !Array.isArray(typed.title)) {
      continue;
    }
    return typed.title
      .map((chunk) => {
        if (!chunk || typeof chunk !== "object") {
          return "";
        }
        const c = chunk as Record<string, unknown>;
        if (typeof c.plain_text === "string") {
          return c.plain_text;
        }
        if (c.text && typeof c.text === "object") {
          const t = c.text as Record<string, unknown>;
          return typeof t.content === "string" ? t.content : "";
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function normalizeDate(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();

  const toIso = (year: number, month: number, day: number): string | null => {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return null;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }
    const dt = new Date(year, month - 1, day);
    if (
      Number.isNaN(dt.getTime()) ||
      dt.getFullYear() !== year ||
      dt.getMonth() + 1 !== month ||
      dt.getDate() !== day
    ) {
      return null;
    }
    return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  };

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (isoMatch) {
    return toIso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const dmy = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dmy) {
    return toIso(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  }

  const dmyNoYear = raw.match(/^(\d{1,2})[\/-](\d{1,2})$/);
  if (dmyNoYear) {
    return toIso(currentYear, Number(dmyNoYear[2]), Number(dmyNoYear[1]));
  }

  const ym = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (ym) {
    return toIso(Number(ym[1]), Number(ym[2]), currentDay);
  }

  const my = raw.match(/^(\d{1,2})[\/-](\d{4})$/);
  if (my) {
    return toIso(Number(my[2]), Number(my[1]), currentDay);
  }

  const dayOnly = raw.match(/^(\d{1,2})$/);
  if (dayOnly) {
    return toIso(currentYear, currentMonth, Number(dayOnly[1]));
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  // JS Date parser can default missing years to 2001 (e.g. "3/4").
  // If no explicit 4-digit year was provided, use current year.
  const hasExplicitYear = /\b\d{4}\b/.test(raw);
  const year = hasExplicitYear ? parsed.getFullYear() : currentYear;
  const month = parsed.getMonth() + 1;
  const day = parsed.getDate();
  return toIso(year, month, day);
}

function getPropertyNames(schema: Record<string, unknown>): PropertyNames {
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const found: PropertyNames = {};

  for (const [name, prop] of Object.entries(props)) {
    const type = String(prop.type ?? "");
    const lowered = name.toLowerCase();
    if (type === "title" && (!found.title || lowered === "item")) {
      found.title = name;
    } else if (type === "number" && (!found.amount || lowered === "amount")) {
      found.amount = name;
    } else if (type === "date" && (!found.date || lowered === "date")) {
      found.date = name;
    } else if (type === "relation" && (!found.category || lowered === "category")) {
      found.category = name;
    } else if (type === "rich_text" && (!found.remarks || lowered === "remarks")) {
      found.remarks = name;
    }
  }

  return found;
}

interface RelationOption {
  id: string;
  title: string;
}

async function getRelationOptions(client: NotionClient, schema: Record<string, unknown>, names: PropertyNames): Promise<RelationOption[]> {
  if (!names.category) {
    return [];
  }
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const relationInfo = properties[names.category]?.relation as Record<string, unknown> | undefined;
  const relationDbId = relationInfo?.database_id;
  if (typeof relationDbId !== "string") {
    return [];
  }

  const pages = await client.queryDatabase(relationDbId);
  const options: RelationOption[] = [];
  for (const page of pages as NotionPage[]) {
    const title = extractTitleFromPage(page);
    if (title) {
      options.push({ id: page.id, title });
    }
  }
  return options;
}

function resolveRelationId(rawCategory: unknown, relationOptions: RelationOption[]): string | null {
  if (!rawCategory || relationOptions.length === 0) {
    return null;
  }

  const raw = String(rawCategory).trim();
  const rawLower = raw.toLowerCase();
  const titleMap = new Map<string, string>(relationOptions.map((o) => [normalizeText(o.title), o.id]));

  const aliases: Array<[string, string]> = [
    ["transport", "Transport"], ["bus", "Transport"], ["mrt", "Transport"], ["grab", "Transport"],
    ["taxi", "Transport"], ["train", "Transport"], ["food", "Food"], ["grocer", "Food"],
    ["shopping", "Lifestyle"], ["lifestyle", "Lifestyle"], ["software", "Lifestyle"],
    ["subscription", "Lifestyle"], ["invest", "Investments"], ["goal", "Goals"],
    ["saving", "Savings"], ["tith", "Tithing"], ["buffer", "Buffer"]
  ];

  for (const [needle, canonical] of aliases) {
    if (rawLower.includes(needle)) {
      const match = titleMap.get(normalizeText(canonical));
      if (match) {
        return match;
      }
    }
  }

  const normalizedRaw = normalizeText(raw);
  if (titleMap.has(normalizedRaw)) {
    return titleMap.get(normalizedRaw) ?? null;
  }

  const loose = relationOptions.find((o) => rawLower.includes(o.title.toLowerCase()) || o.title.toLowerCase().includes(rawLower));
  return loose?.id ?? null;
}

export async function fetchRelationOptionTitles(client: NotionClient, targetDbId: string): Promise<string[]> {
  const schema = (await client.getDatabase(targetDbId)) as Record<string, unknown>;
  const names = getPropertyNames(schema);
  const options = await getRelationOptions(client, schema, names);
  return options.map((o) => o.title);
}

export async function submitRowsToNotion(client: NotionClient, targetDbId: string, rows: ExpenseRow[]): Promise<{ ok: true; count: number }> {
  const schema = (await client.getDatabase(targetDbId)) as Record<string, unknown>;
  const names = getPropertyNames(schema);
  if (!names.title) {
    throw new Error("Could not find title property in target database schema");
  }

  const relationOptions = await getRelationOptions(client, schema, names);
  const signedRows = normalizeRows(rows);

  for (const row of signedRows) {
    const item = row.item || "Unknown";
    const amount = parseAmount(row.amount);
    const isoDate = normalizeDate(row.date);
    if (row.date && !isoDate) {
      throw new Error(`Invalid date after normalization: ${String(row.date)}`);
    }

    const relationId = resolveRelationId(row.category, relationOptions);
    const properties: Record<string, unknown> = {
      [names.title]: { title: [{ text: { content: item } }] }
    };

    if (amount !== null && names.amount) {
      properties[names.amount] = { number: amount };
    }
    if (isoDate && names.date) {
      properties[names.date] = { date: { start: isoDate } };
    }
    if (relationId && names.category) {
      properties[names.category] = { relation: [{ id: relationId }] };
    }

    const remarks: string[] = [];
    if (row.remarks) {
      remarks.push(String(row.remarks));
    }
    if (row.type === "income") {
      remarks.push("Transaction marked as income/refund offset");
    }
    if (remarks.length > 0 && names.remarks) {
      properties[names.remarks] = { rich_text: [{ text: { content: remarks.join("; ").slice(0, 1900) } }] };
    }

    await client.createPage({ databaseId: targetDbId, properties });
  }

  return { ok: true, count: signedRows.length };
}
