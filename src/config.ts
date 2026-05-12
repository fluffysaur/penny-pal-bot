import "dotenv/config";
import { z } from "zod";

function parseAllowedIds(raw: string): Set<number> {
  const values = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v));
  return new Set(values);
}

function parseJsonObject(raw: string, field: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${field} must be a JSON object`);
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[String(k)] = String(v);
    }
    return out;
  } catch (error) {
    throw new Error(`Invalid JSON for ${field}: ${(error as Error).message}`);
  }
}

const EnvSchema = z.object({
  TELEGRAM_TOKEN: z.string().min(1),
  NOTION_TOKEN: z.string().min(1),
  EXPENSE_BOT_ALLOWED_USER_IDS: z.string().min(1),
  EXPENSE_BOT_DEFAULT_DB_ID: z.string().min(1),
  EXPENSE_BOT_USER_DB_MAP_JSON: z.string().default("{}"),
  EXPENSE_BOT_USER_NAMES_JSON: z.string().default("{}"),
  EXPENSE_BOT_DB_LABELS_JSON: z.string().default("{}"),
  EXPENSE_BOT_PROCESS_TIMEOUT: z.coerce.number().int().positive().default(120),
  EXPENSE_BOT_HERMES_TIMEOUT: z.coerce.number().int().positive().default(120)
});

const env = EnvSchema.parse(process.env);

const allowedUserIds = parseAllowedIds(env.EXPENSE_BOT_ALLOWED_USER_IDS);
if (allowedUserIds.size === 0) {
  throw new Error("EXPENSE_BOT_ALLOWED_USER_IDS must include at least one integer ID");
}

const userDbMapRaw = parseJsonObject(env.EXPENSE_BOT_USER_DB_MAP_JSON, "EXPENSE_BOT_USER_DB_MAP_JSON");
const userDbMap = new Map<number, string>();
for (const [k, v] of Object.entries(userDbMapRaw)) {
  const userId = Number(k);
  if (Number.isInteger(userId)) {
    userDbMap.set(userId, v);
  }
}

const userNamesRaw = parseJsonObject(env.EXPENSE_BOT_USER_NAMES_JSON, "EXPENSE_BOT_USER_NAMES_JSON");
const userNames = new Map<number, string>();
for (const [k, v] of Object.entries(userNamesRaw)) {
  const userId = Number(k);
  if (Number.isInteger(userId)) {
    userNames.set(userId, v);
  }
}

export const config = {
  telegramToken: env.TELEGRAM_TOKEN,
  notionToken: env.NOTION_TOKEN,
  defaultDbId: env.EXPENSE_BOT_DEFAULT_DB_ID,
  dbLabels: parseJsonObject(env.EXPENSE_BOT_DB_LABELS_JSON, "EXPENSE_BOT_DB_LABELS_JSON"),
  allowedUserIds,
  userDbMap,
  userNames,
  processTimeoutSeconds: env.EXPENSE_BOT_PROCESS_TIMEOUT,
  visionTimeoutSeconds: env.EXPENSE_BOT_HERMES_TIMEOUT
};
