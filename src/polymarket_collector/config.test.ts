import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPolymarketCollectorConfig } from "./config";

describe("polymarket collector config", () => {
  it("defaults to a disabled, BTC/ETH/SOL 15m data-only collector", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "polymarket-config-"));

    try {
      const config = loadPolymarketCollectorConfig(path.join(dir, ".env"), { cwd: dir });

      expect(config.enabled).toBe(false);
      expect(config.symbols).toEqual(["BTC", "ETH", "SOL"]);
      expect(config.timeframes).toEqual(["15m"]);
      expect(config.pollIntervalSeconds).toBe(5);
      expect(config.saveOrderbook).toBe(true);
      expect(config.saveTrades).toBe(true);
      expect(config.dataDir).toBe(path.join(dir, "data", "polymarket"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses explicit env values without requiring wallet or trading secrets", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "polymarket-config-"));
    const envPath = path.join(dir, ".env");
    writeFileSync(
      envPath,
      [
        "POLYMARKET_COLLECTOR_ENABLED=true",
        "POLYMARKET_TIMEFRAMES=15m,5m",
        "POLYMARKET_SYMBOLS=btc, eth",
        "POLYMARKET_POLL_INTERVAL_SECONDS=12",
        "POLYMARKET_SAVE_ORDERBOOK=false",
        "POLYMARKET_SAVE_TRADES=false"
      ].join("\n"),
      "utf8"
    );

    try {
      const config = loadPolymarketCollectorConfig(envPath, { cwd: dir });

      expect(config.enabled).toBe(true);
      expect(config.timeframes).toEqual(["15m", "5m"]);
      expect(config.symbols).toEqual(["BTC", "ETH"]);
      expect(config.pollIntervalSeconds).toBe(12);
      expect(config.saveOrderbook).toBe(false);
      expect(config.saveTrades).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
