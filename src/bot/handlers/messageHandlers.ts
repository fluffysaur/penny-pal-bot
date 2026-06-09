import type { Telegraf } from "telegraf";
import { config } from "../../config";
import { parseManualEntries } from "../../domain/manualParser";
import type { NotionClient } from "../../integrations/notion/notionClient";
import type { VisionProvider } from "../../integrations/vision/provider";
import { recognizesEditInstruction } from "../../integrations/vision/heuristicVisionProvider";
import { cleanupTempFiles, downloadUrlToTempFile } from "../../utils/files";
import {
  appendManualEntries,
  applyFieldEdit,
  parseRemoveTarget,
  removeEntryAt
} from "../flowHelpers";
import {
  applyCategoryChoice,
  pickTypedCategory,
  showItemEditor,
  showPreviewOrAskCategory
} from "../interactionHelpers";
import { messages } from "../messages";
import { MediaGroupBuffer } from "../mediaGroupBuffer";
import { removeItemKeyboard } from "../formatting";
import { getSession, patchSession, setSession } from "../sessionStore";
import type { UserSession } from "../sessionStore";
import {
  isTimeoutError,
  photoParseTimeoutMs,
  startTyping,
  targetInfoForUser,
  withTimeout
} from "../runtimeHelpers";

interface MessageHandlerDeps {
  notionClient: NotionClient;
  visionProvider: VisionProvider;
}

interface TelegramClient {
  sendMessage(chatId: number | string, text: string, extra?: Record<string, unknown>): Promise<unknown>;
  editMessageText(
    chatId: number | string,
    messageId: number,
    inlineMessageId: undefined,
    text: string,
    extra?: Record<string, unknown>
  ): Promise<unknown>;
  getFileLink(fileId: string): Promise<URL>;
  sendChatAction(chatId: number | string, action: string): Promise<void>;
}

const MEDIA_GROUP_DEBOUNCE_MS = 900;

interface PhotoBatchItem {
  fileId: string;
  messageId: number;
}

interface PhotoBatchPayload {
  telegram: TelegramClient;
  chatId: number | string;
  dbId: string;
  label: string;
  photo: PhotoBatchItem;
}

interface ProcessPhotoBatchParams extends MessageHandlerDeps {
  telegram: TelegramClient;
  chatId: number | string;
  userId: number;
  dbId: string;
  label: string;
  photos: PhotoBatchItem[];
}

async function processPhotoBatch(params: ProcessPhotoBatchParams): Promise<void> {
  const { telegram, chatId, userId, dbId, label, photos, notionClient, visionProvider } = params;
  patchSession(userId, { targetDb: dbId, targetLabel: label, mode: undefined });
  const status = await telegram.sendMessage(chatId, messages.parseInProgress(label, photos.length));
  const statusMessageId = (status as { message_id?: number } | undefined)?.message_id;
  const editStatus = async (text: string, extra?: Record<string, unknown>): Promise<void> => {
    if (!statusMessageId) {
      await telegram.sendMessage(chatId, text, extra);
      return;
    }
    await telegram.editMessageText(chatId, statusMessageId, undefined, text, extra as Record<string, unknown>);
  };

  const tempPaths: string[] = [];
  const stopTyping = startTyping(telegram, chatId);
  try {
    const downloaded = await Promise.all(
      photos.map(async (photo) => {
        const fileLink = await telegram.getFileLink(photo.fileId);
        return downloadUrlToTempFile(fileLink.href, "jpg");
      })
    );
    tempPaths.push(...downloaded);

    const rows = await withTimeout(
      visionProvider.parseImages(tempPaths),
      photoParseTimeoutMs(),
      "Image parsing timed out"
    );
    if (rows.length === 0) {
      await editStatus(messages.parseNoRows);
      return;
    }

    const session = patchSession(userId, { pendingRows: rows, targetDb: dbId, targetLabel: label, mode: undefined });
    await showPreviewOrAskCategory(
      {
        reply: async (text: string, extra?: Record<string, unknown>) => {
          await editStatus(text, extra);
          return {};
        },
        editMessageText: async (text: string, extra?: Record<string, unknown>) => {
          await editStatus(text, extra);
          return {};
        }
      },
      userId,
      session,
      rows,
      notionClient,
      true
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      await editStatus(messages.parseTimedOut);
      return;
    }
    console.error("Photo parsing failed", error);
    await editStatus(messages.parseError);
  } finally {
    stopTyping();
    cleanupTempFiles(tempPaths);
  }
}

export function registerMessageHandlers(bot: Telegraf, deps: MessageHandlerDeps): void {
  const { notionClient, visionProvider } = deps;

  const albumBuffer = new MediaGroupBuffer<PhotoBatchPayload>(MEDIA_GROUP_DEBOUNCE_MS, async (items) => {
    const first = items[0];
    if (!first) {
      return;
    }

    await processPhotoBatch({
      telegram: first.payload.telegram,
      chatId: first.payload.chatId,
      userId: first.userId,
      dbId: first.payload.dbId,
      label: first.payload.label,
      photos: items.map((item) => item.payload.photo),
      notionClient,
      visionProvider
    });
  });

  bot.on("photo", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || !config.allowedUserIds.has(userId)) {
      await ctx.reply(messages.notAllowed);
      return;
    }
    const { dbId, label } = targetInfoForUser(userId);
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const batchPhoto = { fileId: photo.file_id, messageId: ctx.message.message_id };

    if (ctx.message.media_group_id) {
      albumBuffer.add({
        userId,
        mediaGroupId: ctx.message.media_group_id,
        messageId: ctx.message.message_id,
        payload: {
          telegram: ctx.telegram,
          chatId: ctx.message.chat.id,
          dbId,
          label,
          photo: batchPhoto
        }
      });
      return;
    }

    await processPhotoBatch({
      telegram: ctx.telegram,
      chatId: ctx.message.chat.id,
      userId,
      dbId,
      label,
      photos: [batchPhoto],
      notionClient,
      visionProvider
    });
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
        await showPreviewOrAskCategory(ctx, userId, next, rows, notionClient);
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
      await showPreviewOrAskCategory(ctx, userId, next, result.rows, notionClient);
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
      const next = patchSession(userId, { pendingRows: result.rows, mode: "remove_entry", pendingFieldEdit: undefined });
      if (result.rows.length === 0) {
        await ctx.reply("All items removed. Send a new image or /manual entry.");
        return;
      }
      await ctx.reply(
        "Removed. Pick the next item to remove, or type something like 'remove item 2'.",
        removeItemKeyboard(next.pendingRows)
      );
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
        await showPreviewOrAskCategory(ctx, userId, session, session.pendingRows, notionClient);
        return;
      }
      await applyCategoryChoice(ctx, userId, session, item.index, selected, notionClient, item.rawCategory);
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
      const row = next.pendingRows[itemIndex];
      if (!row) {
        await ctx.reply("That item no longer exists. Please reopen the edit menu.");
        return;
      }
      await showItemEditor(ctx, next.targetLabel, itemIndex, row);
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
      await showPreviewOrAskCategory(ctx, userId, next, edited, notionClient);
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
}
