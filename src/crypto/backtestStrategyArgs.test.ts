import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_CONFIG } from "./strategy";
import { buildBacktestSymbolRunnerArgs, parseBacktestSymbolArgs } from "./backtestStrategyArgs";

describe("backtest strategy CLI args", () => {
  it("round-trips timing and exit overrides used by factor-label candidates", () => {
    const strategy = {
      ...DEFAULT_STRATEGY_CONFIG,
      minBuyScore: 81,
      atrStopMultiplier: 1.2,
      takeProfitRiskMultiple: 1.6,
      minPriceVwapPct: -2,
      maxPriceVwapPct: 1,
      minEmaFastSlopePct: -0.2,
      minTakeProfitPct: 0.3,
      minExpectedValuePct: -0.2,
      maxHoldingMinutes: 120,
      entryCooldownMinutes: 0,
      breakevenTriggerPct: 999,
      trailingStopTriggerPct: 999,
      trailingStopGivebackPct: 999,
      signalExitScore: -1
    };

    const args = buildBacktestSymbolRunnerArgs({
      symbolRunner: "src/crypto/runBacktestSymbol.ts",
      symbol: "ETHUSDT",
      days: 14,
      candidate: { strategyId: "factor-label-capitulation-reclaim", strategy }
    });
    const parsed = parseBacktestSymbolArgs(args.slice(1), DEFAULT_STRATEGY_CONFIG);

    expect(parsed.symbol).toBe("ETHUSDT");
    expect(parsed.days).toBe(14);
    expect(parsed.strategyId).toBe("factor-label-capitulation-reclaim");
    expect(parsed.strategy.maxHoldingMinutes).toBe(120);
    expect(parsed.strategy.entryCooldownMinutes).toBe(0);
    expect(parsed.strategy.breakevenTriggerPct).toBe(999);
    expect(parsed.strategy.trailingStopTriggerPct).toBe(999);
    expect(parsed.strategy.trailingStopGivebackPct).toBe(999);
    expect(parsed.strategy.signalExitScore).toBe(-1);
  });
});
