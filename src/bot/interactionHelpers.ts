import { Markup } from "telegraf";
import {
  buildCategoryClarificationText,
  findAmbiguousCategories,
  normalizeKey,
  normalizeRowsCategories,
  rememberCategoryMapping
} from "../domain/categoryHelpers";
import { normalizeRows, parseAmount } from "../domain/expenseSigns";
import type { ExpenseRow } from "../types";
import type { NotionClient } from "../integrations/notion/notionClient";
import { fetchRelationOptionTitles } from "../integrations/notion/submitRows";
import { escapeHtml, itemFieldKeyboard, previewExtra, renderPreviewText } from "./formatting";
import type { UserSession } from "./sessionStore";
import { patchSession } from "./sessionStore";

export interface ReplyOrEditContext {
  reply: (...args: any[]) => Promise<unknown>;
  editMessageText?: (...args: any[]) => Promise<unknown>;
}

export async function sendOrEditMessage(
  ctx: ReplyOrEditContext,
  text: string,
  extra: Record<string, unknown> | undefined,
  preferEdit: boolean
): Promise<void> {
  if (preferEdit && typeof ctx.editMessageText === "function") {
    await ctx.editMessageText(text, extra);
    return;
  }
  await ctx.reply(text, extra);
}

export function formatFieldValue(value: unknown, fallback = "(empty)"): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  const text = String(value).trim();
  return text ? escapeHtml(text) : fallback;
}

export function renderItemEditText(targetLabel: string, itemIndex: number, row: ExpenseRow): string {
  const parsedAmount = parseAmount(row.amount);
  const amount = parsedAmount === null ? formatFieldValue(row.amount) : parsedAmount.toFixed(2);
  const inferredType = parsedAmount !== null ? (parsedAmount > 0 ? "income" : "expense") : (row.type ?? "expense");
  return [
    `Editing <b>${escapeHtml(targetLabel)}</b> item ${itemIndex + 1}`,
    "",
    `<b>Item</b>: ${formatFieldValue(row.item)}`,
    `<b>Amount</b>: ${amount}`,
    `<b>Category</b>: ${formatFieldValue(row.category, "(guess)")}`,
    `<b>Date</b>: ${formatFieldValue(row.date)}`,
    `<b>Remarks</b>: ${formatFieldValue(row.remarks)}`,
    `<b>Type</b>: ${escapeHtml(inferredType)}`,
    "",
    "Choose what to edit:"
  ].join("\n");
}

export async function showItemEditor(
  ctx: ReplyOrEditContext,
  targetLabel: string,
  itemIndex: number,
  row: ExpenseRow,
  preferEdit = false
): Promise<void> {
  await sendOrEditMessage(
    ctx,
    renderItemEditText(targetLabel, itemIndex, row),
    { ...itemFieldKeyboard(itemIndex), parse_mode: "HTML" as const },
    preferEdit
  );
}

export async function showPreview(
  ctx: ReplyOrEditContext,
  targetLabel: string,
  rows: ExpenseRow[],
  preferEdit = false
): Promise<void> {
  await sendOrEditMessage(ctx, renderPreviewText(targetLabel, normalizeRows(rows)), previewExtra(), preferEdit);
}

export function categoryChoiceKeyboard(
  itemIndex: number,
  options: string[],
  hasPrev: boolean,
  hasNext: boolean
) {
  const rows = options.map((title) => [Markup.button.callback(title, `category_pick:${itemIndex}:${normalizeKey(title)}`)]);
  const nav: ReturnType<typeof Markup.button.callback>[] = [];
  if (hasPrev) {
    nav.push(Markup.button.callback("<- Prev", "category_nav:prev"));
  }
  if (hasNext) {
    nav.push(Markup.button.callback("Next ->", "category_nav:next"));
  }
  if (nav.length > 0) {
    rows.push(nav);
  }
  rows.push([Markup.button.callback("Cancel", "cancel")]);
  return Markup.inlineKeyboard(rows);
}

export function pickTypedCategory(input: string, options: string[]): string | null {
  const normalized = normalizeKey(input);
  const exact = options.find((option) => normalizeKey(option) === normalized);
  if (exact) {
    return exact;
  }
  const lowerInput = input.toLowerCase().trim();
  const fuzzy = options.find((option) => option.toLowerCase() === lowerInput);
  return fuzzy ?? null;
}

export async function showPreviewOrAskCategory(
  ctx: ReplyOrEditContext,
  userId: number,
  session: UserSession,
  rows: ExpenseRow[],
  notionClient: NotionClient,
  preferEdit = false
): Promise<void> {
  const relationOptions = await fetchRelationOptionTitles(notionClient, session.targetDb);
  const signed = normalizeRows(rows);
  const normalized = relationOptions.length > 0 ? normalizeRowsCategories(signed, relationOptions) : signed;
  const ambiguous = relationOptions.length > 0 ? findAmbiguousCategories(normalized, relationOptions) : [];

  if (ambiguous.length > 0) {
    const first = ambiguous[0];
    patchSession(userId, {
      pendingRows: normalized,
      mode: "category_clarify",
      categoryOptions: relationOptions,
      ambiguousItems: ambiguous,
      currentAmbiguousPos: 0
    });
    await sendOrEditMessage(
      ctx,
      buildCategoryClarificationText(normalized, ambiguous, 0),
      categoryChoiceKeyboard(first.index, relationOptions, false, ambiguous.length > 1),
      preferEdit
    );
    return;
  }

  patchSession(userId, {
    pendingRows: normalized,
    mode: undefined,
    categoryOptions: undefined,
    ambiguousItems: undefined,
    currentAmbiguousPos: undefined,
    pendingFieldEdit: undefined
  });
  await showPreview(ctx, session.targetLabel, normalized, preferEdit);
}

export async function applyCategoryChoice(
  ctx: ReplyOrEditContext,
  userId: number,
  session: UserSession,
  itemIndex: number,
  choice: string,
  notionClient: NotionClient,
  rawCategory?: string,
  preferEdit = false
): Promise<void> {
  if (itemIndex < 0 || itemIndex >= session.pendingRows.length) {
    await ctx.reply("That item no longer exists. Please retry.");
    return;
  }

  const original = session.pendingRows[itemIndex];
  const updatedRows = session.pendingRows.map((row, idx) => (idx === itemIndex ? { ...row, category: choice } : row));
  rememberCategoryMapping(rawCategory ?? original.category ?? "", choice);
  const nextSession = patchSession(userId, { pendingRows: updatedRows, mode: undefined, pendingFieldEdit: undefined });
  await showPreviewOrAskCategory(ctx, userId, nextSession, updatedRows, notionClient, preferEdit);
}
