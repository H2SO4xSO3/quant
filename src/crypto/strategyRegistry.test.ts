import { describe, expect, it } from "vitest";
import { getStrategyById, listStrategies } from "./strategyRegistry";

describe("strategy registry", () => {
  it("registers the VWAP pullback reclaim strategy by id", () => {
    expect(getStrategyById("vwap-pullback-reclaim").id).toBe("vwap-pullback-reclaim");
    expect(listStrategies().map((strategy) => strategy.id)).toContain("vwap-pullback-reclaim");
  });

  it("registers the Bitget composite router strategy", () => {
    expect(getStrategyById("bitget-composite-router").id).toBe("bitget-composite-router");
    expect(listStrategies().map((strategy) => strategy.id)).toContain("bitget-composite-router");
  });

  it("keeps the Bitget composite router out of trade readiness after the 365d failure", () => {
    const strategy = getStrategyById("bitget-composite-router");

    expect(strategy.readiness).toBe("no_trade");
    expect(strategy.blockedReason).toContain("365d Bitget native futures backtest failed");
  });

  it("registers the futures 50x long-or-short opportunity selector", () => {
    expect(getStrategyById("futures-opportunity-50x").id).toBe("futures-opportunity-50x");
    expect(listStrategies().map((strategy) => strategy.id)).toContain("futures-opportunity-50x");
  });
  it("registers the video EMA structure 50x strategy", () => {
    expect(getStrategyById("video-ema-structure-50x").id).toBe("video-ema-structure-50x");
    expect(listStrategies().map((strategy) => strategy.id)).toContain("video-ema-structure-50x");
  });
});
