import { describe, expect, it } from "vitest";
import { rankBacktestResults, scoreBacktestResult } from "./strategyScoring";
import type { BacktestResult } from "./backtest";

function result(overrides: Partial<BacktestResult["totals"]> = {}, strategyId = "test"): BacktestResult {
  return {
    generatedAt: new Date().toISOString(),
    days: 14,
    strategyId,
    initialCapitalUsdt: 100,
    orderQuoteQty: 10,
    maxOpenPositions: 4,
    strategy: {
      minBuyScore: 80,
      emaFastPeriod: 9,
      emaSlowPeriod: 21,
      emaTrendPeriod: 50,
      higherEmaFastPeriod: 20,
      higherEmaSlowPeriod: 50,
      rsiPeriod: 14,
      atrPeriod: 14,
      atrStopMultiplier: 1,
      takeProfitRiskMultiple: 1,
      minPriceVwapPct: 0.1,
      maxPriceVwapPct: 3,
      minEmaFastSlopePct: 0,
      minHigherTrendGapPct: 0,
      minTakeProfitPct: 0.2,
      minExpectedValuePct: 0,
      estimatedSlippagePct: 0.03,
      priceImpactPct: 0.04,
      maxSpreadPct: 0.18,
      entryCooldownMinutes: 0,
      breakevenTriggerPct: 0.4,
      trailingStopTriggerPct: 0.7,
      trailingStopGivebackPct: 0.3,
      signalExitScore: 42,
      maxHoldingMinutes: 60,
      maxPositionLossUsdt: 1,
      feeRate: 0.001
    },
    symbols: [],
    note: "",
    totals: {
      trades: 30,
      netPnlUsdt: 2,
      endingCapitalUsdt: 102,
      returnPct: 2,
      winRate: 0.45,
      maxDrawdownUsdt: 1,
      maxDrawdownPct: 1,
      profitFactor: 1.4,
      maxConcurrentPositions: 2,
      maxCapitalUsedUsdt: 30,
      capitalUtilizationPct: 30,
      skippedTrades: 0,
      ...overrides
    }
  };
}

describe("strategy scoring", () => {
  it("scores profitable low-drawdown results above losing candidates", () => {
    const good = scoreBacktestResult(result());
    const bad = scoreBacktestResult(result({ netPnlUsdt: -1, returnPct: -1, profitFactor: 0.4, maxDrawdownPct: 4, winRate: 0.2 }));

    expect(good.overallScore).toBeGreaterThan(bad.overallScore);
    expect(good.components.profitFactorScore).toBeGreaterThan(bad.components.profitFactorScore);
  });

  it("ranks candidates by multi-factor score", () => {
    const ranked = rankBacktestResults([
      result({ netPnlUsdt: -0.2, returnPct: -0.2, profitFactor: 0.8 }, "weak"),
      result({ netPnlUsdt: 1.5, returnPct: 1.5, profitFactor: 1.3, maxDrawdownPct: 0.6 }, "strong")
    ]);

    expect(ranked[0].strategyId).toBe("strong");
    expect(ranked[0].score.overallScore).toBeGreaterThan(ranked[1].score.overallScore);
  });
});
