import { spawn, spawnSync } from "node:child_process";
import type { ExpenseRow } from "../../types";
import { config } from "../../config";
import { parseAmount } from "../../domain/expenseSigns";
import type { VisionProvider } from "./provider";
import { extractJsonArray } from "./jsonExtract";

function coerceRows(rawRows: Record<string, unknown>[]): ExpenseRow[] {
  const rows: ExpenseRow[] = [];
  for (const raw of rawRows) {
    const item = String(raw.item ?? raw.name ?? "").trim();
    const amount = parseAmount(raw.amount);
    if (!item || amount === null) {
      continue;
    }
    rows.push({
      item,
      amount,
      category: raw.category ? String(raw.category) : undefined,
      date: raw.date ? String(raw.date) : undefined,
      confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
      remarks: raw.remarks ? String(raw.remarks) : undefined,
      type: raw.type === "income" || raw.type === "expense" ? raw.type : undefined
    });
  }
  return rows;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

async function runHermes(prompt: string): Promise<string> {
  const candidates = ["hermes", "hermes-cli"];
  for (const cmd of candidates) {
    const which = spawnSync("which", [cmd], { encoding: "utf8", timeout: 5000 });
    if (which.status !== 0 || !which.stdout.trim()) {
      continue;
    }

    const proc = await runCommand(cmd, ["chat", "-Q", "-q", prompt], config.visionTimeoutSeconds * 1000);

    if (proc.timedOut) {
      throw new Error(`Hermes vision timed out after ${config.visionTimeoutSeconds}s`);
    }

    if (proc.code === 0 && proc.stdout.trim()) {
      return proc.stdout.trim();
    }

    if (proc.stderr.trim()) {
      console.error(`Hermes provider error (${cmd}):`, proc.stderr.trim().slice(0, 500));
    }
  }

  return "";
}

export class HermesVisionProvider implements VisionProvider {
  public async parseImage(imagePath: string): Promise<ExpenseRow[]> {
    const prompt = [
      `Use vision analysis on this local image path: ${imagePath}`,
      "Extract expense rows and return ONLY a JSON array.",
      "Each row should include item, amount, date, category, confidence.",
      "Use negative amounts for refunds/reimbursements/paybacks."
    ].join("\n");

    const stdout = await runHermes(prompt);
    return coerceRows(extractJsonArray(stdout));
  }

  public async applyEditInstruction(rows: ExpenseRow[], instruction: string): Promise<ExpenseRow[]> {
    const prompt = [
      "You are editing parsed expense rows.",
      "Return ONLY a JSON array.",
      "Preserve keys: item, amount, date, category, confidence, remarks, type.",
      "Keep expenses positive and income/refund rows negative.",
      `Instruction: ${instruction}`,
      `Current rows JSON: ${JSON.stringify(rows)}`
    ].join("\n\n");

    const stdout = await runHermes(prompt);
    const edited = coerceRows(extractJsonArray(stdout));
    return edited.length > 0 ? edited : rows;
  }
}
