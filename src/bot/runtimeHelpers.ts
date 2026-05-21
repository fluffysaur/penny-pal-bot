import { config } from "../config";

export const PHOTO_PARSE_TIMEOUT_MS = 120 * 1000;

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof TimeoutError;
}

export function startTyping(
  telegram: { sendChatAction(chatId: number | string, action: string): Promise<void> },
  chatId: number | string,
  intervalMs = 4000
): () => void {
  void telegram.sendChatAction(chatId, "typing");
  const id = setInterval(() => {
    void telegram.sendChatAction(chatId, "typing");
  }, intervalMs);
  return () => clearInterval(id);
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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

export function targetInfoForUser(userId: number): { dbId: string; label: string } {
  const dbId = config.userDbMap.get(userId) ?? config.defaultDbId;
  const label = config.dbLabels[dbId] ?? "Unknown";
  return { dbId, label };
}
