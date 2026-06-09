import { afterEach, describe, expect, it, vi } from "vitest";

function stubRequiredEnv(): void {
  vi.stubEnv("DOTENV_CONFIG_PATH", "/tmp/penny-pal-bot-missing-test-env");
  vi.stubEnv("TELEGRAM_TOKEN", "telegram-token");
  vi.stubEnv("NOTION_TOKEN", "notion-token");
  vi.stubEnv("EXPENSE_BOT_ALLOWED_USER_IDS", "123");
  vi.stubEnv("EXPENSE_BOT_DEFAULT_DB_ID", "db-default");
  vi.stubEnv("EXPENSE_BOT_USER_DB_MAP_JSON", "{}");
  vi.stubEnv("EXPENSE_BOT_USER_NAMES_JSON", "{}");
  vi.stubEnv("EXPENSE_BOT_DB_LABELS_JSON", "{}");
  vi.stubEnv("EXPENSE_BOT_PROCESS_TIMEOUT", undefined);
  vi.stubEnv("EXPENSE_BOT_HERMES_TIMEOUT", undefined);
  vi.stubEnv("EXPENSE_BOT_HANDLER_TIMEOUT", undefined);
}

async function loadConfigWithDefaultEnv(): Promise<typeof import("../src/config")> {
  vi.resetModules();
  vi.unstubAllEnvs();
  stubRequiredEnv();
  return import("../src/config");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("timeout config", () => {
  it("defaults processing, vision, and handler timeouts to 300 seconds", async () => {
    const { config } = await loadConfigWithDefaultEnv();
    expect(config.processTimeoutSeconds).toBe(300);
    expect(config.visionTimeoutSeconds).toBe(300);
    expect(config.handlerTimeoutSeconds).toBe(300);
  });

  it("uses config for the photo parse timeout", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    stubRequiredEnv();
    const runtime = await import("../src/bot/runtimeHelpers");
    expect(runtime.photoParseTimeoutMs()).toBe(300_000);
  });
});
