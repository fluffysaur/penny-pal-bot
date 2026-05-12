import { createBot } from "./bot/createBot";

async function main(): Promise<void> {
  const bot = createBot();
  await bot.launch();
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((error) => {
  console.error("Failed to start Penny Pal Bot", error);
  process.exit(1);
});
