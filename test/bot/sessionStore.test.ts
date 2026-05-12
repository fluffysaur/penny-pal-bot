import { describe, expect, it } from "vitest";
import { clearSession, getSession, patchSession, setSession } from "../../src/bot/sessionStore";

describe("sessionStore", () => {
  it("stores and fetches session", () => {
    setSession(1, { targetDb: "db", targetLabel: "label", pendingRows: [] });
    expect(getSession(1)?.targetDb).toBe("db");
    clearSession(1);
  });

  it("patches existing session", () => {
    setSession(2, { targetDb: "db-a", targetLabel: "A", pendingRows: [] });
    patchSession(2, { targetLabel: "B" });
    expect(getSession(2)?.targetLabel).toBe("B");
    clearSession(2);
  });
});
