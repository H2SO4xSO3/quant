import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateBacktestGuard } from "./backtestGuard";

function reportPath(payload: unknown) {
  const directory = mkdtempSync(path.join(tmpdir(), "backtest-guard-"));
  const filePath = path.join(directory, "report.json");
  writeFileSync(filePath, JSON.stringify(payload), "utf8");
  return { directory, filePath };
}

describe("backtest guard", () => {
  it("blocks live buys when the latest report is unprofitable", () => {
    const { directory, filePath } = reportPath({
      current: {
        generatedAt: new Date().toISOString(),
        totals: { trades: 12, netPnlUsdt: -0.1, profitFactor: 0.9 }
      }
    });

    try {
      const decision = evaluateBacktestGuard({
        enabled: true,
        reportPath: filePath,
        minNetPnlUsdt: 0,
        minProfitFactor: 1,
        minTrades: 5,
        maxAgeHours: 36,
        requireSymbolHealth: false,
        minSymbolNetPnlUsdt: 0,
        minSymbolProfitFactor: 1,
        minSymbolTrades: 3
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reasons.join(" ")).toContain("Backtest net PnL");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("allows live buys when the recent report clears the health thresholds", () => {
    const { directory, filePath } = reportPath({
      current: {
        generatedAt: new Date().toISOString(),
        totals: { trades: 12, netPnlUsdt: 0.2, profitFactor: 1.2 }
      }
    });

    try {
      const decision = evaluateBacktestGuard({
        enabled: true,
        reportPath: filePath,
        minNetPnlUsdt: 0,
        minProfitFactor: 1,
        minTrades: 5,
        maxAgeHours: 36,
        requireSymbolHealth: false,
        minSymbolNetPnlUsdt: 0,
        minSymbolProfitFactor: 1,
        minSymbolTrades: 3
      });

      expect(decision.allowed).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("blocks a symbol whose own backtest slice is unhealthy", () => {
    const { directory, filePath } = reportPath({
      current: {
        generatedAt: new Date().toISOString(),
        totals: { trades: 20, netPnlUsdt: 0.5, profitFactor: 1.4 },
        symbols: [
          { symbol: "BTCUSDT", trades: [{}, {}, {}], netPnlUsdt: -0.1, profitFactor: 0.8 },
          { symbol: "ETHUSDT", trades: [{}, {}, {}], netPnlUsdt: 0.6, profitFactor: 2.1 }
        ]
      }
    });

    try {
      const decision = evaluateBacktestGuard(
        {
          enabled: true,
          reportPath: filePath,
          minNetPnlUsdt: 0,
          minProfitFactor: 1,
          minTrades: 5,
          maxAgeHours: 36,
          requireSymbolHealth: true,
          minSymbolNetPnlUsdt: 0,
          minSymbolProfitFactor: 1,
          minSymbolTrades: 3
        },
        new Date(),
        "BTCUSDT"
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reasons.join(" ")).toContain("BTCUSDT backtest net PnL");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("allows a healthy symbol even when the wider candidate universe is unhealthy", () => {
    const { directory, filePath } = reportPath({
      current: {
        generatedAt: new Date().toISOString(),
        totals: { trades: 30, netPnlUsdt: -1, profitFactor: 0.5 },
        symbols: [
          { symbol: "BTCUSDT", trades: [{}, {}, {}], netPnlUsdt: -0.4, profitFactor: 0.5 },
          { symbol: "ETHUSDT", trades: [{}, {}, {}], netPnlUsdt: 0.2, profitFactor: 1.4 }
        ]
      }
    });

    try {
      const decision = evaluateBacktestGuard(
        {
          enabled: true,
          reportPath: filePath,
          minNetPnlUsdt: 0,
          minProfitFactor: 1,
          minTrades: 5,
          maxAgeHours: 36,
          requireSymbolHealth: true,
          minSymbolNetPnlUsdt: 0,
          minSymbolProfitFactor: 1,
          minSymbolTrades: 3
        },
        new Date(),
        "ETHUSDT"
      );

      expect(decision.allowed).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
