import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCryptoBotConfig } from "./config";

describe("crypto bot config", () => {
  it("loads dashboard loop autostart switches from env files", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "quant-config-"));
    const envPath = path.join(dir, ".env");
    writeFileSync(envPath, "AUTO_START_BUY_LOOP=true\nAUTO_START_EXIT_GUARDIAN=true\n", "utf8");

    try {
      const config = loadCryptoBotConfig(envPath);

      expect(config.autoStartBuyLoop).toBe(true);
      expect(config.autoStartExitGuardian).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
