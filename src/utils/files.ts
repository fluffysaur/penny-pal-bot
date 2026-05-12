import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function downloadUrlToTempFile(url: string, extension = "bin"): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const bytes = await response.arrayBuffer();
  const dir = mkdtempSync(join(tmpdir(), "penny-pal-"));
  const filePath = join(dir, `input.${extension}`);
  writeFileSync(filePath, Buffer.from(bytes));
  return filePath;
}

export function cleanupTempFile(filePath: string): void {
  try {
    rmSync(dirname(filePath), { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
}
