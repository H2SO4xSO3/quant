import { describe, expect, it } from "vitest";
import { analyzeMarket, computeDonchianCloseChannel } from "./indicators";

const klines = [
  [1, "100", "101", "99", "100", "10", 2, "1000"],
  [2, "100", "103", "100", "102", "20", 3, "2040"],
  [3, "102", "104", "101", "103", "30", 4, "3090"],
  [4, "103", "105", "102", "104", "40", 5, "4160"]
];
const depth = {
  bids: [
    ["103.9", "5"],
    ["103.5", "10"],
    ["102.8", "20"]
  ],
  asks: [
    ["104.1", "4"],
    ["104.5", "8"],
    ["105.2", "10"]
  ]
};
const trades = [
  { p: "103.9", q: "1", m: false, T: 1 },
  { p: "104.0", q: "2", m: false, T: 2 },
  { p: "103.8", q: "1", m: true, T: 3 },
  { p: "104.2", q: "6", m: false, T: 4 }
];

describe("crypto market indicators", () => {
  it("computes VWAP, volume profile, footprint, deep trade and liquidity stats", () => {
    const analysis = analyzeMarket({ symbol: "BTCUSDT", klines, depth, trades });

    expect(analysis.price).toBe(104);
    expect(analysis.vwap).toBeCloseTo(102.9);
    expect(analysis.priceVsVwapPct).toBeGreaterThan(0);
    expect(analysis.volumeProfile.pointOfControl.price).toBeGreaterThan(103);
    expect(analysis.footprint.buySellImbalance).toBeGreaterThan(0);
    expect(analysis.deepTrades.largeTradeBuyRatio).toBe(1);
    expect(analysis.liquidity.bidAskImbalance).toBeGreaterThan(0);
    expect(analysis.technical?.candleBodyPct).toBeCloseTo((1 / 103) * 100);
    expect(analysis.technical?.closePosition).toBeCloseTo(2 / 3);
  });

  it("computes a prior-window volatility channel for breakout checks", () => {
    const channelKlines = Array.from({ length: 25 }, (_, index) => {
      const close = 100 + index * 0.1;
      return [index + 1, String(close - 0.05), String(close + 0.2), String(close - 0.2), String(close), "10", index, String(close * 10)];
    });
    channelKlines.push([26, "102.5", "105", "102.4", "104", "20", 26, "2080"]);

    const analysis = analyzeMarket({ symbol: "BTCUSDT", klines: channelKlines, depth, trades });

    expect(analysis.technical?.volatilityChannel).toBeDefined();
    expect(analysis.technical?.volatilityChannel?.highestHigh).toBeLessThan(105);
    expect(analysis.technical?.volatilityChannel?.breakoutPct).toBeGreaterThan(0);
  });

  it("computes a prior-window Donchian close channel for long breakout checks", () => {
    const rows = Array.from({ length: 433 }, (_, index) => ({
      openTime: index,
      open: 100 + index * 0.01,
      high: 100 + index * 0.01 + 0.2,
      low: 100 + index * 0.01 - 0.2,
      close: 100 + index * 0.01,
      volume: 10,
      quoteVolume: 1000
    }));
    rows[431].close = 120;
    rows[432].close = 121;

    const channel = computeDonchianCloseChannel(rows, 432);

    expect(channel?.period).toBe(432);
    expect(channel?.upperClose).toBe(120);
    expect(channel?.lowerClose).toBe(100);
    expect(channel?.breakoutPct).toBeCloseTo((1 / 120) * 100);
    expect(channel?.breakdownPct).toBeGreaterThan(0);
  });

  it("adds Donchian close channels by period when enough rows are available", () => {
    const channelKlines = Array.from({ length: 433 }, (_, index) => {
      const close = 100 + index * 0.01;
      return [index + 1, String(close), String(close + 0.2), String(close - 0.2), String(close), "10", index, String(close * 10)];
    });
    channelKlines[431][4] = "120";
    channelKlines[432][4] = "121";

    const analysis = analyzeMarket({ symbol: "BNBUSDT", klines: channelKlines, depth, trades });

    expect(analysis.technical?.donchianCloseByPeriod?.[432]?.upperClose).toBe(120);
    expect(analysis.technical?.donchianCloseByPeriod?.[216]?.upperClose).toBe(120);
  });
  it("derives 1h structure bias without changing the 15m trend input", () => {
    const hourlyKlines = [
      [1, "110", "112", "108", "111", "10", 2, "1110"],
      [2, "111", "113", "109", "112", "10", 3, "1120"],
      [3, "112", "114", "110", "113", "10", 4, "1130"],
      [4, "113", "115", "111", "114", "10", 5, "1140"],
      [5, "114", "116", "112", "115", "10", 6, "1150"],
      [6, "115", "116", "100", "101", "30", 7, "3030"],
      [7, "101", "103", "98", "99", "20", 8, "1980"]
    ];
    const higherKlines = Array.from({ length: 60 }, (_, index) => {
      const close = 100 + index * 0.1;
      return [index + 1, String(close), String(close + 0.2), String(close - 0.2), String(close), "10", index, String(close * 10)];
    });

    const analysis = analyzeMarket({ symbol: "ETHUSDT", klines, higherKlines, hourlyKlines, depth, trades });

    expect(analysis.trend?.higherTrend).toBe("bullish");
    expect(analysis.technical?.hourlyStructure).toMatchObject({
      bias: "short",
      brokenLevelKind: "support"
    });
    expect(analysis.technical?.hourlyStructure?.breakoutPct).toBeLessThan(0);
  });
});
