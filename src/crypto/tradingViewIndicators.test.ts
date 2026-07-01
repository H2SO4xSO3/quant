import { describe, expect, it } from "vitest";
import {
  computeRangeFilterSeries,
  runColorGatedSignalBacktest,
  runFlipSignalBacktest,
  runRangePreTriggerBacktest,
  runRiskRewardSignalBacktest,
  type FramaChannelPoint,
  type RangeFilterPoint
} from "./tradingViewIndicators";
import type { ParsedKline } from "./types";

function row(index: number, close: number): ParsedKline {
  return {
    openTime: index * 60_000,
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: 1,
    quoteVolume: close
  };
}

function rangePoint(index: number, filter: number, highBand: number, lowBand: number): RangeFilterPoint {
  return {
    openTime: index * 60_000,
    filter,
    highBand,
    lowBand,
    upward: 0,
    downward: 0,
    longCondition: false,
    shortCondition: false
  };
}

function framaPoint(index: number, frama: number, upper: number, lower: number): FramaChannelPoint {
  return {
    openTime: index * 60_000,
    frama,
    upper,
    lower,
    breakUp: false,
    breakDown: false,
    candleColor: "neutral"
  };
}

describe("TradingView indicator backtest helpers", () => {
  it("emits Range Filter labels only when direction flips", () => {
    const rows = [100, 101, 102, 99, 98, 103, 104].map((close, index) => row(index, close));

    const points = computeRangeFilterSeries(rows, { samplingPeriod: 1, rangeMultiplier: 0.5 });

    expect(points.map((point) => point.signal)).toEqual([undefined, undefined, undefined, "sell", undefined, "buy", undefined]);
  });

  it("reverses on opposite labels and ignores same-side labels", () => {
    const rows = [100, 110, 120, 90, 80, 130].map((close, index) => row(index, close));
    const signals = [undefined, "buy", "buy", "sell", "sell", "buy"] as const;

    const result = runFlipSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      marginUsdt: 100,
      leverage: 25,
      feeRate: 0
    });

    expect(result.trades).toHaveLength(3);
    expect(result.trades[0]).toMatchObject({ direction: "long", entryPrice: 110, exitPrice: 90 });
    expect(result.trades[1]).toMatchObject({ direction: "short", entryPrice: 90, exitPrice: 130 });
    expect(result.trades[2]).toMatchObject({ direction: "long", entryPrice: 130, exitReason: "end" });
  });

  it("enters from the previous Range Filter high band before a buy label exists and exits at the FRAMA upper band", () => {
    const rows = [
      { ...row(0, 100), high: 101, low: 99 },
      { ...row(1, 101), high: 103, low: 100 },
      { ...row(2, 105), high: 106, low: 103 }
    ];
    const range = [rangePoint(0, 100, 102, 98), rangePoint(1, 101, 103, 99), rangePoint(2, 102, 104, 100)];
    const frama = [framaPoint(0, 100, 106, 94), framaPoint(1, 101, 106, 96), framaPoint(2, 102, 106, 98)];

    const result = runRangePreTriggerBacktest({
      symbol: "MUUSDT",
      rows,
      range,
      frama,
      marginUsdt: 100,
      leverage: 1,
      feeRate: 0
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: "long",
      entryPrice: 102,
      exitPrice: 106,
      exitReason: "take_profit"
    });
  });

  it("uses the tighter Range Filter or FRAMA middle line as the pre-trigger stop", () => {
    const rows = [
      { ...row(0, 100), high: 101, low: 99 },
      { ...row(1, 101), high: 103, low: 100 },
      { ...row(2, 99), high: 101, low: 100 }
    ];
    const range = [rangePoint(0, 100, 102, 98), rangePoint(1, 101, 103, 99), rangePoint(2, 100, 102, 98)];
    const frama = [framaPoint(0, 101, 106, 94), framaPoint(1, 101, 106, 96), framaPoint(2, 100, 105, 95)];

    const result = runRangePreTriggerBacktest({
      symbol: "MUUSDT",
      rows,
      range,
      frama,
      marginUsdt: 100,
      leverage: 1,
      feeRate: 0
    });

    expect(result.trades[0]).toMatchObject({
      direction: "long",
      entryPrice: 102,
      exitPrice: 101,
      exitReason: "stop_loss"
    });
  });

  it("uses at least one Range Filter band width for pre-trigger take profit when FRAMA is too close", () => {
    const rows = [
      { ...row(0, 100), high: 101, low: 99 },
      { ...row(1, 101), high: 103, low: 100 },
      { ...row(2, 104), high: 104, low: 103 }
    ];
    const range = [rangePoint(0, 100, 102, 98), rangePoint(1, 101, 103, 99), rangePoint(2, 102, 104, 100)];
    const frama = [framaPoint(0, 100, 102.5, 94), framaPoint(1, 101, 103, 96), framaPoint(2, 102, 104, 98)];

    const result = runRangePreTriggerBacktest({
      symbol: "MUUSDT",
      rows,
      range,
      frama,
      marginUsdt: 100,
      leverage: 1,
      feeRate: 0
    });

    expect(result.trades[0]).toMatchObject({
      direction: "long",
      entryPrice: 102,
      exitPrice: 104,
      exitReason: "take_profit"
    });
  });

  it("can require close confirmation before stopping out a pre-trigger trade", () => {
    const rows = [
      { ...row(0, 100), high: 101, low: 99 },
      { ...row(1, 101), high: 103, low: 100 },
      { ...row(2, 103), high: 103.5, low: 100.5 },
      { ...row(3, 104), high: 104, low: 103 }
    ];
    const range = [rangePoint(0, 100, 102, 98), rangePoint(1, 101, 103, 99), rangePoint(2, 101, 103, 99), rangePoint(3, 102, 104, 100)];
    const frama = [framaPoint(0, 101, 102.5, 94), framaPoint(1, 101, 103, 96), framaPoint(2, 101, 104, 97), framaPoint(3, 102, 104, 98)];

    const result = runRangePreTriggerBacktest({
      symbol: "MUUSDT",
      rows,
      range,
      frama,
      marginUsdt: 100,
      leverage: 1,
      feeRate: 0,
      stopTrigger: "close"
    });

    expect(result.trades[0]).toMatchObject({
      direction: "long",
      entryPrice: 102,
      exitPrice: 104,
      exitReason: "take_profit"
    });
  });

  it("does not re-enter the same pre-trigger direction until the opposite side is touched", () => {
    const rows = [
      { ...row(0, 100), high: 101, low: 99 },
      { ...row(1, 101), high: 103, low: 100 },
      { ...row(2, 99), high: 101, low: 100 },
      { ...row(3, 101), high: 103, low: 100 },
      { ...row(4, 102), high: 104, low: 101 }
    ];
    const range = [
      rangePoint(0, 100, 102, 98),
      rangePoint(1, 101, 103, 99),
      rangePoint(2, 100, 102, 98),
      rangePoint(3, 101, 103, 99),
      rangePoint(4, 102, 104, 100)
    ];
    const frama = [
      framaPoint(0, 101, 106, 94),
      framaPoint(1, 101, 106, 96),
      framaPoint(2, 100, 106, 95),
      framaPoint(3, 101, 106, 96),
      framaPoint(4, 102, 106, 97)
    ];

    const result = runRangePreTriggerBacktest({
      symbol: "MUUSDT",
      rows,
      range,
      frama,
      marginUsdt: 100,
      leverage: 1,
      feeRate: 0
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ direction: "long", exitReason: "stop_loss" });
  });

  it("closes a flip-signal trade after max hold bars when no opposite label appears", () => {
    const rows = [100, 101, 102, 103, 104, 105, 106, 107, 108].map((close, index) => row(index, close));
    const signals = [undefined, "buy", "buy", undefined, undefined, undefined, undefined, undefined, undefined] as const;

    const result = runFlipSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      marginUsdt: 100,
      leverage: 25,
      feeRate: 0,
      maxHoldBars: 7
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: "long",
      entryPrice: 101,
      exitPrice: 108,
      exitReason: "time_exit"
    });
  });

  it("reverses before max hold bars when an opposite label appears", () => {
    const rows = [100, 101, 102, 99, 98].map((close, index) => row(index, close));
    const signals = [undefined, "buy", undefined, "sell", undefined] as const;

    const result = runFlipSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      marginUsdt: 100,
      leverage: 25,
      feeRate: 0,
      maxHoldBars: 7
    });

    expect(result.trades[0]).toMatchObject({
      direction: "long",
      entryPrice: 101,
      exitPrice: 99,
      exitReason: "reverse"
    });
  });

  it("uses pre-start rows as indicator warmup without trading them", () => {
    const rows = [100, 90, 110, 80, 120].map((close, index) => row(index, close));
    const signals = ["buy", "sell", "buy", "sell", "buy"] as const;

    const result = runFlipSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      marginUsdt: 100,
      leverage: 25,
      feeRate: 0,
      tradeStartTime: rows[2].openTime
    });

    expect(result.trades).toHaveLength(3);
    expect(result.candles).toBe(3);
    expect(result.trades[0]).toMatchObject({ direction: "long", entryPrice: 110, exitPrice: 80 });
    expect(result.trades[1]).toMatchObject({ direction: "short", entryPrice: 80, exitPrice: 120 });
    expect(result.trades[2]).toMatchObject({ direction: "long", entryPrice: 120, exitReason: "end" });
  });

  it("closes a long on a FRAMA upper-band pullback after the band has been reached", () => {
    const rows = [
      { ...row(0, 100), high: 100.5, low: 99.5 },
      { ...row(1, 110), high: 110.5, low: 109.5 },
      { ...row(2, 116), high: 116.5, low: 115.5 },
      { ...row(3, 115), high: 116, low: 114 },
      { ...row(4, 130), high: 130.5, low: 129.5 }
    ];
    const signals = [undefined, "buy", undefined, "sell", undefined] as const;
    const framaExitBands = [
      {},
      { upper: 115, lower: 95 },
      { upper: 115, lower: 95 },
      { upper: 115, lower: 95 },
      { upper: 115, lower: 95 }
    ];

    const result = runFlipSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      framaExitBands,
      marginUsdt: 100,
      leverage: 25,
      feeRate: 0
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: "long",
      entryPrice: 110,
      exitPrice: 115,
      exitReason: "frama_channel"
    });
  });

  it("holds only Range Filter signals that agree with FRAMA candle colors and exits on neutral", () => {
    const rows = [100, 105, 110, 103, 99, 95].map((close, index) => row(index, close));
    const signals = ["buy", "buy", undefined, undefined, "sell", undefined] as const;
    const framaColors = ["neutral", "up", "up", "neutral", "down", "neutral"] as const;

    const result = runColorGatedSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      framaColors,
      marginUsdt: 100,
      leverage: 25,
      feeRate: 0
    });

    expect(result.trades).toHaveLength(2);
    expect(result.trades[0]).toMatchObject({
      direction: "long",
      entryPrice: 105,
      exitPrice: 103,
      exitReason: "frama_neutral"
    });
    expect(result.trades[1]).toMatchObject({
      direction: "short",
      entryPrice: 99,
      exitPrice: 95,
      exitReason: "frama_neutral"
    });
  });

  it("ignores Range Filter labels when FRAMA candles are neutral", () => {
    const rows = [100, 105, 110].map((close, index) => row(index, close));
    const signals = ["buy", "sell", "buy"] as const;
    const framaColors = ["neutral", "neutral", "neutral"] as const;

    const result = runColorGatedSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      framaColors,
      marginUsdt: 100,
      leverage: 25,
      feeRate: 0
    });

    expect(result.trades).toHaveLength(0);
    expect(result.endingEquityUsdt).toBe(100);
  });

  it("uses signal-candle wick risk with 1.5R take profit before opposite labels", () => {
    const rows = [
      { ...row(0, 100), high: 101, low: 99 },
      { ...row(1, 100), high: 102, low: 98 },
      { ...row(2, 105), high: 106, low: 104 },
      { ...row(3, 101), high: 102, low: 100 }
    ];
    const signals = [undefined, "buy", "sell", undefined] as const;

    const result = runRiskRewardSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      riskRewardRatio: 1.5,
      marginUsdt: 100,
      leverage: 1,
      feeRate: 0
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      direction: "long",
      entryPrice: 100,
      exitPrice: 103,
      exitReason: "take_profit"
    });
  });

  it("assumes stop loss first when take profit and stop loss are both touched in one bar", () => {
    const rows = [
      { ...row(0, 100), high: 101, low: 99 },
      { ...row(1, 100), high: 102, low: 98 },
      { ...row(2, 100), high: 104, low: 97 }
    ];
    const signals = [undefined, "buy", undefined] as const;

    const result = runRiskRewardSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      riskRewardRatio: 1.5,
      marginUsdt: 100,
      leverage: 1,
      feeRate: 0
    });

    expect(result.trades[0]).toMatchObject({
      direction: "long",
      exitPrice: 98,
      exitReason: "stop_loss"
    });
  });

  it("closes a leveraged position at liquidation before the next opposite label", () => {
    const rows = [
      { ...row(0, 100), low: 99 },
      { ...row(1, 100), low: 99 },
      { ...row(2, 94), low: 94 }
    ];
    const signals = [undefined, "buy", undefined] as const;

    const result = runFlipSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      marginUsdt: 100,
      leverage: 25,
      feeRate: 0,
      maintenanceMarginRate: 0.005
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ direction: "long", exitReason: "liquidation", pnlUsdt: -100 });
  });

  it("can stop a backtest when all-in equity is depleted", () => {
    const rows = [row(0, 100), row(1, 100), { ...row(2, 90), low: 90 }, row(3, 110)];
    const signals = [undefined, "buy", undefined, "sell"] as const;

    const result = runFlipSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      marginUsdt: 100,
      leverage: 25,
      feeRate: 0,
      maintenanceMarginRate: 0.005,
      compoundEquity: true
    });

    expect(result.trades).toHaveLength(1);
    expect(result.endingEquityUsdt).toBe(0);
    expect(result.stoppedReason).toBe("equity_depleted");
  });

  it("stops all-in testing when equity falls below the minimum trade margin", () => {
    const rows = [row(0, 100), row(1, 100), row(2, 98), row(3, 101)];
    const signals = [undefined, "buy", "sell", "buy"] as const;

    const result = runFlipSignalBacktest({
      symbol: "MUUSDT",
      rows,
      signals,
      marginUsdt: 1.1,
      leverage: 25,
      feeRate: 0.0006,
      compoundEquity: true,
      minTradeMarginUsdt: 1
    });

    expect(result.trades).toHaveLength(1);
    expect(result.endingEquityUsdt).toBeLessThan(1);
    expect(result.stoppedReason).toBe("equity_depleted");
  });
});
