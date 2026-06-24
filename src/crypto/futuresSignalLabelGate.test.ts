import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateFuturesSignalLabelGate, wrapStrategyWithFuturesSignalLabelGate } from "./futuresSignalLabelGate";
import type { CryptoStrategy } from "./strategyTypes";
import type { CryptoSignal } from "./types";

function reportPath(payload: unknown) {
  const directory = mkdtempSync(path.join(tmpdir(), "futures-label-gate-"));
  const filePath = path.join(directory, "report.json");
  writeFileSync(filePath, JSON.stringify(payload), "utf8");
  return { directory, filePath };
}

function report(buckets: unknown[]) {
  return {
    generatedAt: new Date().toISOString(),
    buckets
  };
}

function signal(overrides: Partial<CryptoSignal> = {}): CryptoSignal {
  return {
    symbol: "ETHUSDT",
    action: "sell",
    score: 100,
    entryPrice: 100,
    stopLoss: 101,
    takeProfit: 98,
    orderQuoteQty: 20,
    reasons: ["candidate"],
    ...overrides
  };
}

describe("futures signal label gate", () => {
  it("blocks a futures short when no recent short bucket has positive edge", () => {
    const { directory, filePath } = reportPath(report([{ name: "short-vwap-breakdown", direction: "short", trades: 80, netPnlPct: -5, profitFactor: 0.8 }]));

    try {
      const decision = evaluateFuturesSignalLabelGate(filePath, signal({ action: "sell" }));

      expect(decision.allowed).toBe(false);
      expect(decision.reasons.join(" ")).toContain("Label gate blocked sell");
      expect(decision.reasons.join(" ")).toContain("no profitable short bucket");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("allows a futures long when a recent long bucket clears sample, net, and profit-factor gates", () => {
    const { directory, filePath } = reportPath(report([{ name: "long-high-volume-breakout", direction: "long", trades: 60, netPnlPct: 3.2, profitFactor: 1.25 }]));

    try {
      const decision = evaluateFuturesSignalLabelGate(filePath, signal({ action: "buy" }));

      expect(decision.allowed).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("wraps an executable strategy signal into hold when label evidence is not good enough", () => {
    const { directory, filePath } = reportPath(report([{ name: "short-vwap-breakdown", direction: "short", trades: 80, netPnlPct: -5, profitFactor: 0.8 }]));
    const base: CryptoStrategy = {
      id: "test-short",
      label: "Test short",
      generateSignal: () => signal({ action: "sell" })
    };

    try {
      const wrapped = wrapStrategyWithFuturesSignalLabelGate(base, { enabled: true, reportPath: filePath });
      const result = wrapped.generateSignal({ analysis: {} as never, orderQuoteQty: 20, config: {} as never });

      expect(result.action).toBe("hold");
      expect(result.reasons.join(" ")).toContain("Label gate blocked sell");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
