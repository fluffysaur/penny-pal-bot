import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
