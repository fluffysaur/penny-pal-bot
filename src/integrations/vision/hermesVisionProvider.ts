import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function runInIsolatedHermesHome<T>(fn: (isolatedHome: string) => Promise<T>): Promise<T> {
  const isolatedHome = mkdtempSync(join(tmpdir(), "pennypal-hermes-"));
  const wrapped = async (): Promise<T> => {
    try {
      return await fn(isolatedHome);
    } finally {
      try {
        rmSync(isolatedHome, { recursive: true, force: true });
      } catch {
        // Best effort cleanup.
      }
    }
  };
  return wrapped();
}

function runCommand(cmd: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env });
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

async function runHermes(prompt: string, imagePath?: string): Promise<string> {
  const candidates = ["hermes", "hermes-cli"];
  for (const cmd of candidates) {
    const which = spawnSync("which", [cmd], { encoding: "utf8", timeout: 5000 });
    if (which.status !== 0 || !which.stdout.trim()) {
      continue;
    }

    const proc = await runInIsolatedHermesHome(async (isolatedHome) => {
      const isolatedEnv: NodeJS.ProcessEnv = {
        ...process.env,
        HERMES_HOME: isolatedHome
      };
      const args = [
        "chat",
        "-Q",
        "--provider",
        process.env.HERMES_INFERENCE_PROVIDER ?? "github-copilot",
        "-m",
        process.env.HERMES_INFERENCE_MODEL ?? "gpt-5.3-codex",
        "--ignore-rules"
      ];
      if (imagePath) {
        args.push("--image", imagePath);
      }
      args.push("-q", prompt);
      return runCommand(
        cmd,
        args,
        config.visionTimeoutSeconds * 1000,
        isolatedEnv
      );
    });

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
    const primaryPrompt = [
      "Extract expense rows from the attached image and return ONLY a JSON array.",
      "Each row should include item, amount, date, category, confidence.",
      "Use negative amounts for refunds/reimbursements/paybacks.",
      "If there are no transactions, return []."
    ].join("\n");

    const primaryStdout = await runHermes(primaryPrompt, imagePath);
    const primaryRows = coerceRows(extractJsonArray(primaryStdout));
    if (primaryRows.length > 0) {
      return primaryRows;
    }

    const retryPrompt = [
      "You are doing OCR on a transaction screenshot.",
      "Return ONLY a JSON array of best-effort transaction rows, even if confidence is low.",
      "Do not return prose or markdown.",
      "Each row must include item and amount; include date/category/confidence when available.",
      "Use negative amounts for refunds/reimbursements/paybacks.",
      "If absolutely no transaction-like text exists, return []."
    ].join("\n");

    const retryStdout = await runHermes(retryPrompt, imagePath);
    return coerceRows(extractJsonArray(retryStdout));
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
