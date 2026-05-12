import { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import { config } from "../config";
import {
  buildCategoryClarificationText,
  findAmbiguousCategories,
  normalizeKey,
  normalizeRowsCategories,
  rememberCategoryMapping
} from "../domain/categoryHelpers";
import { normalizeRows } from "../domain/expenseSigns";
import { parseManualEntries } from "../domain/manualParser";
import type { ExpenseRow } from "../types";
import { NotionClient } from "../integrations/notion/notionClient";
import { fetchRelationOptionTitles, submitRowsToNotion } from "../integrations/notion/submitRows";
import { CompositeVisionProvider } from "../integrations/vision/compositeVisionProvider";
import { HeuristicVisionProvider, recognizesEditInstruction } from "../integrations/vision/heuristicVisionProvider";
import { HermesVisionProvider } from "../integrations/vision/hermesVisionProvider";
import { cleanupTempFile, downloadUrlToTempFile } from "../utils/files";
import {
  appendManualEntries,
  applyFieldEdit,
  hasUnresolvedCategories,
  parseRemoveTarget,
  removeEntryAt
} from "./flowHelpers";
import { messages } from "./messages";
import { editMenuKeyboard, escapeHtml, itemFieldKeyboard, previewExtra, removeItemKeyboard, renderPreviewText } from "./formatting";
import type { UserSession } from "./sessionStore";
import { clearSession, getSession, patchSession, setSession } from "./sessionStore";

const notionClient = new NotionClient(config.notionToken);
const visionProvider = new CompositeVisionProvider([
  new HeuristicVisionProvider(),
  new HermesVisionProvider()
]);
const PHOTO_PARSE_TIMEOUT_MS = 120 * 1000;

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof TimeoutError;
}

function startTyping(telegram: { sendChatAction(chatId: number | string, action: string): Promise<void> }, chatId: number | string, intervalMs = 4000): () => void {
  void telegram.sendChatAction(chatId, "typing");
  const id = setInterval(() => { void telegram.sendChatAction(chatId, "typing"); }, intervalMs);
  return () => clearInterval(id);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function targetInfoForUser(userId: number): { dbId: string; label: string } {
  const dbId = config.userDbMap.get(userId) ?? config.defaultDbId;
  const label = config.dbLabels[dbId] ?? "Unknown";
  return { dbId, label };
}

async function showPreview(ctx: { reply: (...args: any[]) => Promise<unknown> }, targetLabel: string, rows: ExpenseRow[]): Promise<void> {
  await ctx.reply(renderPreviewText(targetLabel, normalizeRows(rows)), previewExtra());
}

function categoryChoiceKeyboard(
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

function pickTypedCategory(input: string, options: string[]): string | null {
  const normalized = normalizeKey(input);
  const exact = options.find((option) => normalizeKey(option) === normalized);
  if (exact) {
    return exact;
  }
  const lowerInput = input.toLowerCase().trim();
  const fuzzy = options.find((option) => option.toLowerCase() === lowerInput);
  return fuzzy ?? null;
}

async function showPreviewOrAskCategory(
  ctx: { reply: (...args: any[]) => Promise<unknown> },
  userId: number,
  session: UserSession,
  rows: ExpenseRow[]
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
    await ctx.reply(
      buildCategoryClarificationText(normalized, ambiguous, 0),
      categoryChoiceKeyboard(first.index, relationOptions, false, ambiguous.length > 1)
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
  await showPreview(ctx, session.targetLabel, normalized);
}

async function applyCategoryChoice(
  ctx: { reply: (...args: any[]) => Promise<unknown> },
  userId: number,
  session: UserSession,
  itemIndex: number,
  choice: string,
  rawCategory?: string
): Promise<void> {
  if (itemIndex < 0 || itemIndex >= session.pendingRows.length) {
    await ctx.reply("That item no longer exists. Please retry.");
    return;
  }

  const original = session.pendingRows[itemIndex];
  const updatedRows = session.pendingRows.map((row, idx) => (idx === itemIndex ? { ...row, category: choice } : row));
  rememberCategoryMapping(rawCategory ?? original.category ?? "", choice);
  const nextSession = patchSession(userId, { pendingRows: updatedRows, mode: undefined, pendingFieldEdit: undefined });
  await showPreviewOrAskCategory(ctx, userId, nextSession, updatedRows);
}

export function createBot(): Telegraf {
  const bot = new Telegraf(config.telegramToken);

  bot.start(async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    const { dbId, label } = targetInfoForUser(userId);
    const name = config.userNames.get(userId) ?? label;
    setSession(userId, { targetDb: dbId, targetLabel: label, pendingRows: [] });
    await ctx.reply(messages.welcome(name));
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(messages.help);
  });

  bot.command("cancel", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId) {
      clearSession(userId);
    }
    await ctx.reply(messages.cancelled);
  });

  bot.command("manual", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    if (!config.allowedUserIds.has(userId)) {
      await ctx.reply(messages.notAllowed);
      return;
    }
    const { dbId, label } = targetInfoForUser(userId);
    patchSession(userId, { targetDb: dbId, targetLabel: label, pendingRows: [], mode: "manual_add" });
    await ctx.reply(messages.manualPrompt(label));
  });

  bot.action("cancel", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId) {
      clearSession(userId);
    }
    await ctx.answerCbQuery();
    await ctx.editMessageText(messages.cancelled);
  });

  bot.action("edit_mode", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    const session = getSession(userId);
    if (!session || session.pendingRows.length === 0) {
      await ctx.answerCbQuery();
      await ctx.editMessageText("No pending rows found. Send a new image or use /manual.");
      return;
    }
    patchSession(userId, { mode: "freeform_edit", pendingFieldEdit: undefined });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "Editing mode enabled. Send an instruction like:\n" +
      "- remove item 2\n" +
      "- for item 1, set amount to: 4.50\n" +
      "- for item 3, set category to: Food"
    );
  });

  bot.action("edit_menu", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    const session = getSession(userId);
    if (!session || session.pendingRows.length === 0) {
      await ctx.answerCbQuery();
      await ctx.editMessageText("No pending rows found. Send a new image or use /manual.");
      return;
    }
    patchSession(userId, { mode: "freeform_edit", pendingFieldEdit: undefined });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `Editing ${session.targetLabel} entries. Choose an item below, or send a free-form instruction.`,
      editMenuKeyboard(session.pendingRows)
    );
  });

  bot.action("show_preview", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    const session = getSession(userId);
    if (!session || session.pendingRows.length === 0) {
      await ctx.answerCbQuery();
      await ctx.editMessageText("No pending rows found. Send a new image or use /manual.");
      return;
    }
    await ctx.answerCbQuery();
    await ctx.editMessageText(renderPreviewText(session.targetLabel, normalizeRows(session.pendingRows)), previewExtra());
  });

  bot.action(/edit_item:(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    const session = getSession(userId);
    if (!session) {
      await ctx.answerCbQuery();
      return;
    }
    const idx = Number(ctx.match[1]);
    const row = session.pendingRows[idx];
    if (!row) {
      await ctx.answerCbQuery();
      await ctx.editMessageText("That item no longer exists. Please reopen the edit menu.");
      return;
    }
    patchSession(userId, { pendingFieldEdit: undefined });
    await ctx.answerCbQuery();
    await ctx.editMessageText(`Choose what to edit for item ${idx + 1} (${row.item}).`, itemFieldKeyboard(idx));
  });

  bot.action(/edit_field:(\d+):(name|amount|category|date|remarks)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    const session = getSession(userId);
    if (!session) {
      await ctx.answerCbQuery();
      return;
    }
    const idx = Number(ctx.match[1]);
    const field = String(ctx.match[2]) as "name" | "amount" | "category" | "date" | "remarks";
    const row = session.pendingRows[idx];
    if (!row) {
      await ctx.answerCbQuery();
      await ctx.editMessageText("That item no longer exists. Please reopen the edit menu.");
      return;
    }

    const patch: Partial<UserSession> = {
      pendingFieldEdit: { itemIndex: idx, field },
      mode: "freeform_edit"
    };
    if (field === "category") {
      const options = await fetchRelationOptionTitles(notionClient, session.targetDb);
      patch.categoryOptions = options;
      patchSession(userId, patch);
      await ctx.answerCbQuery();
      if (options.length > 0) {
        await ctx.editMessageText(
          `Pick a category for item ${idx + 1} (<b>${escapeHtml(row.item.slice(0, 40))}</b>), or type one:`,
          { ...categoryChoiceKeyboard(idx, options, false, false), parse_mode: "HTML" as const }
        );
      } else {
        await ctx.editMessageText(`Send the new category for item ${idx + 1}. Current: ${String(row.category ?? "")}`);
      }
      return;
    }
    patchSession(userId, patch);
    const currentValue = field === "name" ? row.item : row[field];
    await ctx.answerCbQuery();
    await ctx.editMessageText(`Send the new ${field} for item ${idx + 1}. Current: ${String(currentValue ?? "")}`);
  });

  bot.action(/edit_type:(\d+):(income|expense)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    const session = getSession(userId);
    if (!session) {
      await ctx.answerCbQuery();
      return;
    }
    const idx = Number(ctx.match[1]);
    const transactionType = String(ctx.match[2]) as "income" | "expense";
    if (idx < 0 || idx >= session.pendingRows.length) {
      await ctx.answerCbQuery();
      await ctx.editMessageText("That item no longer exists. Please reopen the edit menu.");
      return;
    }
    const updated = session.pendingRows.map((row, i) => (i === idx ? { ...row, type: transactionType } : row));
    const next = patchSession(userId, { pendingRows: updated, pendingFieldEdit: undefined });
    await ctx.answerCbQuery();
    await showPreviewOrAskCategory(ctx, userId, next, updated);
  });

  bot.action(/delete_item:(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    const session = getSession(userId);
    if (!session) {
      await ctx.answerCbQuery();
      return;
    }
    const idx = Number(ctx.match[1]);
    if (idx < 0 || idx >= session.pendingRows.length) {
      await ctx.answerCbQuery();
      await ctx.editMessageText("That item no longer exists. Please reopen the edit menu.");
      return;
    }
    const updated = session.pendingRows.filter((_, i) => i !== idx);
    const next = patchSession(userId, { pendingRows: updated, pendingFieldEdit: undefined });
    await ctx.answerCbQuery();
    if (updated.length === 0) {
      await ctx.reply("All items removed. Send a new image or /manual entry.");
      return;
    }
    await showPreviewOrAskCategory(ctx, userId, next, updated);
  });

  bot.action("approve", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    const session = getSession(userId);
    if (!session || session.pendingRows.length === 0) {
      await ctx.answerCbQuery();
      await ctx.editMessageText("No pending rows found - nothing to submit.");
      return;
    }

    await ctx.answerCbQuery();
    await ctx.editMessageText(messages.submitInProgress(session.targetLabel));

    const stopTyping = startTyping(ctx.telegram, ctx.callbackQuery.message!.chat.id);
    try {
      const options = await fetchRelationOptionTitles(notionClient, session.targetDb);
      if (hasUnresolvedCategories(session.pendingRows, options)) {
        await showPreviewOrAskCategory(ctx, userId, session, session.pendingRows);
        return;
      }
      await submitRowsToNotion(notionClient, session.targetDb, session.pendingRows);
      clearSession(userId);
      await ctx.reply(messages.submitSuccess(session.targetLabel));
    } catch (error) {
      await ctx.reply(`Submit failed: ${(error as Error).message}`);
    } finally {
      stopTyping();
    }
  });

  bot.action("edit_add", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    const session = getSession(userId);
    if (!session) {
      await ctx.answerCbQuery();
      return;
    }
    patchSession(userId, { mode: "add_entry", pendingFieldEdit: undefined });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "Send the new entry to add.\n" +
      "Format: item | amount | category | date | remarks\n" +
      "Example: Coffee | 4.50 | Food | 2026-05-04 | reimbursable"
    );
  });

  bot.action("edit_remove", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    const session = getSession(userId);
    if (!session) {
      await ctx.answerCbQuery();
      return;
    }
    patchSession(userId, { mode: "remove_entry", pendingFieldEdit: undefined });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "Pick the item to remove, or type something like 'remove item 2'.",
      removeItemKeyboard(session.pendingRows)
    );
  });

  bot.action(/remove_item:(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    const session = getSession(userId);
    if (!session) {
      await ctx.answerCbQuery();
      return;
    }
    const idx = Number(ctx.match[1]);
    const result = removeEntryAt(session.pendingRows, idx);
    if (result.error) {
      await ctx.answerCbQuery();
      await ctx.editMessageText(result.error);
      return;
    }
    const next = patchSession(userId, { pendingRows: result.rows, mode: undefined, pendingFieldEdit: undefined });
    await ctx.answerCbQuery("Removed");
    if (result.rows.length === 0) {
      await ctx.editMessageText("All items removed. Send a new image or /manual entry.");
      return;
    }
    await ctx.editMessageText(renderPreviewText(session.targetLabel, normalizeRows(next.pendingRows)), previewExtra());
  });

  bot.on("photo", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !config.allowedUserIds.has(userId)) {
      await ctx.reply(messages.notAllowed);
      return;
    }
    const { dbId, label } = targetInfoForUser(userId);
    patchSession(userId, { targetDb: dbId, targetLabel: label, mode: undefined });
    await ctx.reply(messages.parseInProgress(label));

    let tempPath: string | undefined;
    const stopTyping = startTyping(ctx.telegram, ctx.message.chat.id);
    try {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const fileLink = await ctx.telegram.getFileLink(photo.file_id);
      tempPath = await downloadUrlToTempFile(fileLink.href, "jpg");
      const rows = await withTimeout(
        visionProvider.parseImage(tempPath),
        PHOTO_PARSE_TIMEOUT_MS,
        "Image parsing timed out"
      );
      if (rows.length === 0) {
        await ctx.reply(messages.parseNoRows);
        return;
      }

      const session = patchSession(userId, { pendingRows: rows, targetDb: dbId, targetLabel: label, mode: undefined });
      await showPreviewOrAskCategory(ctx, userId, session, rows);
    } catch (error) {
      if (isTimeoutError(error)) {
        await ctx.reply(messages.parseTimedOut);
        return;
      }
      console.error("Photo parsing failed", error);
      await ctx.reply(messages.parseError);
    } finally {
      stopTyping();
      if (tempPath) {
        cleanupTempFile(tempPath);
      }
    }
  });

  bot.on("text", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !config.allowedUserIds.has(userId)) {
      await ctx.reply(messages.notAllowed);
      return;
    }

    const text = ctx.message.text.trim();
    if (!text) {
      return;
    }

    const session: UserSession = getSession(userId) ?? (() => {
      const { dbId, label } = targetInfoForUser(userId);
      const s: UserSession = { targetDb: dbId, targetLabel: label, pendingRows: [] };
      setSession(userId, s);
      return s;
    })();

    if (session.mode === "manual_add") {
      try {
        const rows = parseManualEntries(text);
        const next = patchSession(userId, { pendingRows: rows, mode: undefined });
        await showPreviewOrAskCategory(ctx, userId, next, rows);
      } catch (error) {
        await ctx.reply(`${(error as Error).message}\n\nFormat: item | amount | category | date | remarks`);
      }
      return;
    }

    if (session.mode === "add_entry") {
      const result = appendManualEntries(session.pendingRows, text);
      if (result.error) {
        await ctx.reply(`${result.error}\n\nFormat: item | amount | category | date | remarks`);
        return;
      }
      const next = patchSession(userId, { pendingRows: result.rows, mode: undefined, pendingFieldEdit: undefined });
      await showPreviewOrAskCategory(ctx, userId, next, result.rows);
      return;
    }

    if (session.mode === "remove_entry") {
      const target = parseRemoveTarget(text);
      if (target === null) {
        await ctx.reply("Could not determine which item to remove. Try: remove item 2");
        return;
      }
      const result = removeEntryAt(session.pendingRows, target);
      if (result.error) {
        await ctx.reply(result.error);
        return;
      }
      const next = patchSession(userId, { pendingRows: result.rows, mode: undefined, pendingFieldEdit: undefined });
      if (result.rows.length === 0) {
        await ctx.reply("All items removed. Send a new image or /manual entry.");
        return;
      }
      await showPreviewOrAskCategory(ctx, userId, next, result.rows);
      return;
    }

    if (session.mode === "category_clarify") {
      const options = session.categoryOptions ?? [];
      const selected = pickTypedCategory(text, options);
      if (!selected) {
        await ctx.reply("I could not match that category. Please tap one of the buttons or type an exact category name.");
        return;
      }
      const ambiguous = session.ambiguousItems ?? [];
      const pos = session.currentAmbiguousPos ?? 0;
      const item = ambiguous[pos];
      if (!item) {
        await showPreviewOrAskCategory(ctx, userId, session, session.pendingRows);
        return;
      }
      await applyCategoryChoice(ctx, userId, session, item.index, selected, item.rawCategory);
      return;
    }

    if (session.pendingFieldEdit) {
      const { itemIndex, field } = session.pendingFieldEdit;
      const result = applyFieldEdit(session.pendingRows, itemIndex, field, text, session.categoryOptions ?? []);
      if (result.error) {
        await ctx.reply(result.error);
        return;
      }
      const next = patchSession(userId, { pendingRows: result.rows, pendingFieldEdit: undefined });
      await showPreviewOrAskCategory(ctx, userId, next, result.rows);
      return;
    }

    if (session.pendingRows.length === 0) {
      await ctx.reply("Please send a photo/screenshot of a transaction, or use /manual.");
      return;
    }

    await ctx.reply(messages.processingEdit);
    const stopTyping = startTyping(ctx.telegram, ctx.message.chat.id);
    try {
      const recognized = recognizesEditInstruction(text);
      const edited = await visionProvider.applyEditInstruction(session.pendingRows, text);
      const next = patchSession(userId, { pendingRows: edited, mode: undefined, pendingFieldEdit: undefined });
      await showPreviewOrAskCategory(ctx, userId, next, edited);
      if (!recognized && JSON.stringify(edited) === JSON.stringify(session.pendingRows)) {
        await ctx.reply(`I could not understand that edit. ${messages.help}`);
      }
    } catch (error) {
      console.error("Edit instruction failed", error);
      await ctx.reply("I could not apply that edit just now 😕. Please try again or use the buttons.");
    } finally {
      stopTyping();
    }
  });

  bot.action(/category_pick:(\d+):([a-z0-9]+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    const session = getSession(userId);
    const isCategoryPick = session?.mode === "category_clarify" || session?.pendingFieldEdit?.field === "category";
    if (!session || !isCategoryPick) {
      await ctx.answerCbQuery();
      await ctx.reply("No active category selection. Send a new photo or use /manual.");
      return;
    }

    const idx = Number(ctx.match[1]);
    const normalized = String(ctx.match[2]);
    const options = session.categoryOptions ?? [];
    const choice = options.find((option) => normalizeKey(option) === normalized);
    if (!choice) {
      await ctx.answerCbQuery();
      await ctx.reply("That category option is no longer available.");
      return;
    }

    const ambiguous = session.ambiguousItems ?? [];
    const pos = session.currentAmbiguousPos ?? 0;
    const current = ambiguous[pos];
    await ctx.answerCbQuery();
    // For field-edit context there's no ambiguous item; pass undefined rawCategory
    const rawCategory = session.mode === "category_clarify" ? ambiguous[pos]?.rawCategory : undefined;
    await applyCategoryChoice(ctx, userId, session, idx, choice, rawCategory);
  });

  bot.action(/category_nav:(prev|next)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    const session = getSession(userId);
    if (!session || session.mode !== "category_clarify") {
      await ctx.answerCbQuery();
      return;
    }

    const ambiguous = session.ambiguousItems ?? [];
    if (ambiguous.length === 0) {
      await ctx.answerCbQuery();
      return;
    }

    const currentPos = session.currentAmbiguousPos ?? 0;
    const dir = String(ctx.match[1]);
    const nextPos = dir === "prev"
      ? Math.max(0, currentPos - 1)
      : Math.min(ambiguous.length - 1, currentPos + 1);

    const current = ambiguous[nextPos];
    patchSession(userId, { currentAmbiguousPos: nextPos });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      buildCategoryClarificationText(session.pendingRows, ambiguous, nextPos),
      categoryChoiceKeyboard(
        current.index,
        session.categoryOptions ?? [],
        nextPos > 0,
        nextPos < ambiguous.length - 1
      )
    );
  });

  return bot;
}
