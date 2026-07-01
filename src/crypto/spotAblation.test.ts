import { describe, expect, it } from "vitest";
import { buildSpotAblationCandidates } from "./spotAblation";
import { DEFAULT_STRATEGY_CONFIG } from "./strategy";

describe("spot ablation candidates", () => {
  it("builds the requested A-J deterministic spot ablations", () => {
    const candidates = buildSpotAblationCandidates({
      baseStrategyId: "ema-vwap-quality-breakout",
      baseConfig: DEFAULT_STRATEGY_CONFIG,
      symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "PEPEUSDT"]
    });

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "A_full_current",
      "B_no_ai_review",
      "C_no_rsi_filter",
      "D_no_vwap_filter",
      "E_no_15m_higher_trend_filter",
      "F_minimal_trend_vwap_reclaim",
      "G_high_liquidity_only",
      "H_exclude_wide_spread_noise",
      "I_max_hold_120m",
      "I_max_hold_240m",
      "J_wider_tp_sl_cost_buffer"
    ]);
    expect(candidates.find((candidate) => candidate.id === "B_no_ai_review")?.notes.join(" ")).toContain("AI review is not used by backtest");
    expect(candidates.find((candidate) => candidate.id === "G_high_liquidity_only")?.symbols).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
    expect(candidates.find((candidate) => candidate.id === "I_max_hold_120m")?.strategy.maxHoldingMinutes).toBe(120);
    expect(candidates.find((candidate) => candidate.id === "I_max_hold_240m")?.strategy.maxHoldingMinutes).toBe(240);
  });
});
