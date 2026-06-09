import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanupTempFile, cleanupTempFiles } from "../../src/utils/files";

describe("files utilities", () => {
  it("cleans up temporary download directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "penny-pal-test-"));
    const filePath = join(dir, "input.jpg");
    writeFileSync(filePath, "test");

    expect(existsSync(filePath)).toBe(true);
    cleanupTempFile(filePath);
    expect(existsSync(dirname(filePath))).toBe(false);
  });

  it("cleans up multiple temporary download directories", () => {
    const firstDir = mkdtempSync(join(tmpdir(), "penny-pal-test-"));
    const secondDir = mkdtempSync(join(tmpdir(), "penny-pal-test-"));
    const firstPath = join(firstDir, "input.jpg");
    const secondPath = join(secondDir, "input.jpg");
    writeFileSync(firstPath, "first");
    writeFileSync(secondPath, "second");

    cleanupTempFiles([firstPath, secondPath]);

    expect(existsSync(dirname(firstPath))).toBe(false);
    expect(existsSync(dirname(secondPath))).toBe(false);
  });
});
