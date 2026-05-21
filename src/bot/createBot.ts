import { Telegraf } from "telegraf";
import { config } from "../config";
import { NotionClient } from "../integrations/notion/notionClient";
import { CompositeVisionProvider } from "../integrations/vision/compositeVisionProvider";
import { HeuristicVisionProvider } from "../integrations/vision/heuristicVisionProvider";
import { HermesVisionProvider } from "../integrations/vision/hermesVisionProvider";
import { registerActionHandlers } from "./handlers/actionHandlers";
import { registerMessageHandlers } from "./handlers/messageHandlers";
import { messages } from "./messages";
import { targetInfoForUser } from "./runtimeHelpers";
import { clearSession, patchSession, setSession } from "./sessionStore";

const notionClient = new NotionClient(config.notionToken);
const visionProvider = new CompositeVisionProvider([
  new HeuristicVisionProvider(),
  new HermesVisionProvider()
]);

export function createBot(): Telegraf {
  const bot = new Telegraf(config.telegramToken, {
    handlerTimeout: config.handlerTimeoutSeconds * 1000
  });

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

  registerActionHandlers(bot, { notionClient });
  registerMessageHandlers(bot, { notionClient, visionProvider });

  bot.catch((error, ctx) => {
    console.error("Unhandled bot error", {
      error,
      update_id: ctx.update?.update_id,
      updateType: ctx.updateType
    });
  });

  return bot;
}
