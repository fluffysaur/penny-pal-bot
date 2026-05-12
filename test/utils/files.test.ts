import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanupTempFile } from "../../src/utils/files";

describe("files utilities", () => {
  it("cleans up temporary download directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "penny-pal-test-"));
    const filePath = join(dir, "input.jpg");
    writeFileSync(filePath, "test");

    expect(existsSync(filePath)).toBe(true);
    cleanupTempFile(filePath);
    expect(existsSync(dirname(filePath))).toBe(false);
  });
});
