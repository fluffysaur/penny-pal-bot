import type { Telegraf } from "telegraf";
import { buildCategoryClarificationText, normalizeKey, rememberCategoryMapping } from "../../domain/categoryHelpers";
import { parseAmount } from "../../domain/expenseSigns";
import type { NotionClient } from "../../integrations/notion/notionClient";
import { fetchRelationOptionTitles, submitRowsToNotion } from "../../integrations/notion/submitRows";
import { hasUnresolvedCategories, removeEntryAt, applyFieldEdit } from "../flowHelpers";
import { editMenuKeyboard, escapeHtml, removeItemKeyboard } from "../formatting";
import {
  applyCategoryChoice,
  categoryChoiceKeyboard,
  formatFieldValue,
  showItemEditor,
  showPreview,
  showPreviewOrAskCategory
} from "../interactionHelpers";
import { messages } from "../messages";
import { clearSession, getSession, patchSession } from "../sessionStore";
import type { UserSession } from "../sessionStore";
import { startTyping } from "../runtimeHelpers";

interface ActionHandlerDeps {
  notionClient: NotionClient;
}

export function registerActionHandlers(bot: Telegraf, deps: ActionHandlerDeps): void {
  const { notionClient } = deps;

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
    await showPreview(ctx, session.targetLabel, session.pendingRows, true);
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
    await showItemEditor(ctx, session.targetLabel, idx, row, true);
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
          `Pick a category for item ${idx + 1} (<b>${escapeHtml(row.item.slice(0, 40))}</b>).\nCurrent: <b>${formatFieldValue(row.category, "(guess)")}</b>\n\nYou can tap below or type one:`,
          { ...categoryChoiceKeyboard(idx, options, false, false), parse_mode: "HTML" as const }
        );
      } else {
        await ctx.editMessageText(
          `Send the new category for item ${idx + 1}.\nCurrent: <b>${formatFieldValue(row.category, "(guess)")}</b>`,
          { parse_mode: "HTML" as const }
        );
      }
      return;
    }

    patchSession(userId, patch);
    const currentValue = field === "name" ? row.item : row[field];
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `Send the new ${field} for item ${idx + 1}.\nCurrent: <b>${formatFieldValue(currentValue)}</b>`,
      { parse_mode: "HTML" as const }
    );
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
    const updated = session.pendingRows.map((row, i) => {
      if (i !== idx) {
        return row;
      }
      const parsed = parseAmount(row.amount);
      if (parsed === null) {
        return { ...row, type: transactionType };
      }
      const abs = Math.abs(parsed);
      const signedAmount = transactionType === "income" ? abs : -abs;
      return { ...row, type: transactionType, amount: signedAmount };
    });
    const next = patchSession(userId, { pendingRows: updated, pendingFieldEdit: undefined });
    await ctx.answerCbQuery();
    await showItemEditor(ctx, next.targetLabel, idx, next.pendingRows[idx], true);
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
      await ctx.editMessageText("All items removed. Send a new image or /manual entry.");
      return;
    }
    await showPreviewOrAskCategory(ctx, userId, next, updated, notionClient, true);
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
        await showPreviewOrAskCategory(ctx, userId, session, session.pendingRows, notionClient, true);
        return;
      }
      await submitRowsToNotion(notionClient, session.targetDb, session.pendingRows);
      clearSession(userId);
      await ctx.editMessageText(messages.submitSuccess(session.targetLabel));
    } catch (error) {
      await ctx.editMessageText(`Submit failed: ${(error as Error).message}`);
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
    const next = patchSession(userId, { pendingRows: result.rows, mode: "remove_entry", pendingFieldEdit: undefined });
    await ctx.answerCbQuery("Removed");
    if (result.rows.length === 0) {
      await ctx.editMessageText("All items removed. Send a new image or /manual entry.");
      return;
    }
    await ctx.editMessageText(
      "Pick the next item to remove, or type something like 'remove item 2'.",
      removeItemKeyboard(next.pendingRows)
    );
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

    await ctx.answerCbQuery();

    if (session.pendingFieldEdit?.field === "category") {
      const editResult = applyFieldEdit(session.pendingRows, idx, "category", choice, options);
      if (editResult.error) {
        await ctx.editMessageText(editResult.error);
        return;
      }
      const original = session.pendingRows[idx];
      rememberCategoryMapping(original?.category ?? "", choice);
      const next = patchSession(userId, {
        pendingRows: editResult.rows,
        pendingFieldEdit: undefined,
        mode: "freeform_edit"
      });
      const row = next.pendingRows[idx];
      if (!row) {
        await ctx.editMessageText("That item no longer exists. Please reopen the edit menu.");
        return;
      }
      await showItemEditor(ctx, next.targetLabel, idx, row, true);
      return;
    }

    const ambiguous = session.ambiguousItems ?? [];
    const pos = session.currentAmbiguousPos ?? 0;
    const rawCategory = session.mode === "category_clarify" ? ambiguous[pos]?.rawCategory : undefined;
    await applyCategoryChoice(ctx, userId, session, idx, choice, notionClient, rawCategory, true);
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
}
