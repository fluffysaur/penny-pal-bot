import type { ExpenseRow } from "../../types";
import { config } from "../../config";
import type { VisionProvider } from "./provider";

async function withProviderTimeout<T>(promise: Promise<T>, timeoutMs: number, providerName: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${providerName} timed out`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export class CompositeVisionProvider implements VisionProvider {
  constructor(private readonly providers: VisionProvider[]) {}

  public async parseImage(imagePath: string): Promise<ExpenseRow[]> {
    let lastError: Error | undefined;
    const timeoutMs = config.processTimeoutSeconds * 1000;
    for (const provider of this.providers) {
      try {
        const rows = await withProviderTimeout(provider.parseImage(imagePath), timeoutMs, provider.constructor.name);
        if (rows.length > 0) {
          return rows;
        }
      } catch (error) {
        lastError = error as Error;
        console.error(`Vision provider ${provider.constructor.name} failed`, error);
      }
    }
    if (lastError) {
      throw lastError;
    }
    return [];
  }

  public async applyEditInstruction(rows: ExpenseRow[], instruction: string): Promise<ExpenseRow[]> {
    for (const provider of this.providers) {
      const edited = await provider.applyEditInstruction(rows, instruction);
      if (edited.length > 0) {
        return edited;
      }
    }
    return rows;
  }
}
