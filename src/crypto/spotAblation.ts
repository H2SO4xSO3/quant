import { emaVwapQualityBreakoutStrategy } from "./strategies/emaVwapQualityBreakout";
import { buildLongTradePlan, clampScore, defaultTrendForAnalysis, trendGapPct } from "./tradeMath";
import { emaVwapTrendStrategy } from "./strategy";
import type { CryptoStrategy } from "./strategyTypes";
import type { CryptoSignal, CryptoStrategyConfig } from "./types";

export interface SpotAblationCandidate {
  id: string;
  label: string;
  strategyId: string;
  strategy: CryptoStrategyConfig;
  signalStrategy: CryptoStrategy;
  symbols: string[];
  notes: string[];
}

export interface SpotAblationInput {
  baseStrategyId: string;
  baseConfig: CryptoStrategyConfig;
  symbols: string[];
}

const MAJOR_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

function baseSpotStrategy(id: string): CryptoStrategy {
  if (id === emaVwapQualityBreakoutStrategy.id) {
    return emaVwapQualityBreakoutStrategy;
  }
  return emaVwapTrendStrategy;
}

function isBlocker(reason: string): boolean {
  return /blocked|cooldown|floor|outside|does not clear|below the|above the|too |not bullish|not above|not show|lacks|avoid|missing/i.test(reason);
}

function ignoringReasons(base: CryptoStrategy, id: string, label: string, patterns: RegExp[]): CryptoStrategy {
  return {
    id,
    label,
    generateSignal: (input): CryptoSignal => {
      const signal = base.generateSignal(input);
      if (signal.action === "buy") {
        return signal;
      }
      const reasons = signal.reasons.filter((reason) => !patterns.some((pattern) => pattern.test(reason)));
      const remainingBlockers = reasons.filter(isBlocker);
      return {
        ...signal,
        action: remainingBlockers.length === 0 && signal.score >= input.config.minBuyScore ? "buy" : "hold",
        reasons: [...reasons, `${label}: ignored ${patterns.map((pattern) => pattern.source).join("/")} blockers for ablation only`]
      };
    }
  };
}

function spreadFiltered(base: CryptoStrategy): CryptoStrategy {
  return {
    id: "exclude-wide-spread-noise",
    label: "Exclude wide spread noise",
    generateSignal: (input): CryptoSignal => {
      const signal = base.generateSignal(input);
      if (signal.action === "buy" && input.analysis.liquidity.nearestAskDistancePct > 0.08) {
        return {
          ...signal,
          action: "hold",
          reasons: [...signal.reasons, `Ablation spread/liquidity filter blocked ${input.analysis.liquidity.nearestAskDistancePct.toFixed(3)}% spread`]
        };
      }
      return signal;
    }
  };
}

export const minimalTrendVwapReclaimStrategy: CryptoStrategy = {
  id: "minimal-trend-vwap-reclaim",
  label: "Minimal 15m trend + VWAP reclaim",
  generateSignal: ({ analysis, orderQuoteQty, config }) => {
    const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
    const tradePlan = buildLongTradePlan({ analysis, trend, score: 80, orderQuoteQty, config });
    const reasons: string[] = [];
    const hardReasons: string[] = [];
    if (trend.higherTrend === "bullish" && trendGapPct(trend) >= 0) {
      reasons.push("15m trend is bullish");
    } else {
      hardReasons.push("15m trend is not bullish");
    }
    if (analysis.price > analysis.vwap && analysis.priceVsVwapPct >= 0 && analysis.priceVsVwapPct <= 0.8) {
      reasons.push("5m price reclaimed VWAP without major extension");
    } else {
      hardReasons.push(`VWAP reclaim distance ${analysis.priceVsVwapPct.toFixed(2)}% is not executable`);
    }
    if (tradePlan.takeProfitPct < config.minTakeProfitPct) {
      hardReasons.push(`Gross take-profit ${tradePlan.takeProfitPct.toFixed(2)}% does not clear the ${config.minTakeProfitPct}% minimum`);
    }
    const score = hardReasons.length === 0 ? 82 : 55;
    return {
      symbol: analysis.symbol,
      action: hardReasons.length === 0 ? "buy" : "hold",
      score: clampScore(score),
      entryPrice: tradePlan.entryPrice,
      stopLoss: tradePlan.stopLoss,
      takeProfit: tradePlan.takeProfit,
      orderQuoteQty: tradePlan.orderQuoteQty,
      reasons: hardReasons.length > 0 ? [...reasons, ...hardReasons] : reasons
    };
  }
};

function candidate(input: {
  id: string;
  label: string;
  strategyId: string;
  strategy: CryptoStrategyConfig;
  signalStrategy: CryptoStrategy;
  symbols: string[];
  notes: string[];
}): SpotAblationCandidate {
  return input;
}

export function buildSpotAblationCandidates(input: SpotAblationInput): SpotAblationCandidate[] {
  const base = baseSpotStrategy(input.baseStrategyId);
  const highLiquiditySymbols = input.symbols.filter((symbol) => MAJOR_SYMBOLS.includes(symbol));
  const liquidPlusXrp = input.symbols.filter((symbol) => [...MAJOR_SYMBOLS, "XRPUSDT"].includes(symbol));
  return [
    candidate({
      id: "A_full_current",
      label: "A. Current full strategy",
      strategyId: input.baseStrategyId,
      strategy: input.baseConfig,
      signalStrategy: base,
      symbols: input.symbols,
      notes: ["Current deterministic strategy as configured."]
    }),
    candidate({
      id: "B_no_ai_review",
      label: "B. No AI review",
      strategyId: input.baseStrategyId,
      strategy: input.baseConfig,
      signalStrategy: base,
      symbols: input.symbols,
      notes: ["AI review is not used by backtest; this should match A unless live/paper AI veto data is analyzed separately."]
    }),
    candidate({
      id: "C_no_rsi_filter",
      label: "C. Remove RSI filter",
      strategyId: "ablation-no-rsi",
      strategy: input.baseConfig,
      signalStrategy: ignoringReasons(base, "ablation-no-rsi", "No RSI filter", [/RSI/i]),
      symbols: input.symbols,
      notes: ["Ignores RSI blockers only; all other blockers remain."]
    }),
    candidate({
      id: "D_no_vwap_filter",
      label: "D. Remove VWAP filter",
      strategyId: "ablation-no-vwap",
      strategy: input.baseConfig,
      signalStrategy: ignoringReasons(base, "ablation-no-vwap", "No VWAP filter", [/VWAP/i]),
      symbols: input.symbols,
      notes: ["Ignores VWAP blockers only; all other blockers remain."]
    }),
    candidate({
      id: "E_no_15m_higher_trend_filter",
      label: "E. Remove 15m higher trend filter",
      strategyId: "ablation-no-15m",
      strategy: input.baseConfig,
      signalStrategy: ignoringReasons(base, "ablation-no-15m", "No 15m filter", [/15m/i]),
      symbols: input.symbols,
      notes: ["Ignores 15m higher-trend blockers only; all other blockers remain."]
    }),
    candidate({
      id: "F_minimal_trend_vwap_reclaim",
      label: "F. Minimal trend + VWAP reclaim",
      strategyId: minimalTrendVwapReclaimStrategy.id,
      strategy: { ...input.baseConfig, signalExitScore: -1 },
      signalStrategy: minimalTrendVwapReclaimStrategy,
      symbols: input.symbols,
      notes: ["Keeps only 15m bullish trend, 5m VWAP reclaim, and fixed stop/take-profit plan."]
    }),
    candidate({
      id: "G_high_liquidity_only",
      label: "G. High liquidity majors only",
      strategyId: input.baseStrategyId,
      strategy: input.baseConfig,
      signalStrategy: base,
      symbols: highLiquiditySymbols,
      notes: ["Restricts symbols to BTC/ETH/SOL/BNB if present."]
    }),
    candidate({
      id: "H_exclude_wide_spread_noise",
      label: "H. Exclude wide spread/noise",
      strategyId: "ablation-spread-noise-filter",
      strategy: { ...input.baseConfig, maxSpreadPct: Math.min(input.baseConfig.maxSpreadPct, 0.08) },
      signalStrategy: spreadFiltered(base),
      symbols: liquidPlusXrp,
      notes: ["Restricts to liquid symbols and blocks synthetic/observed spread above 0.08%."]
    }),
    candidate({
      id: "I_max_hold_120m",
      label: "I. Max holding 120m",
      strategyId: input.baseStrategyId,
      strategy: { ...input.baseConfig, maxHoldingMinutes: 120 },
      signalStrategy: base,
      symbols: input.symbols,
      notes: ["Extends max holding time to 120 minutes."]
    }),
    candidate({
      id: "I_max_hold_240m",
      label: "I. Max holding 240m",
      strategyId: input.baseStrategyId,
      strategy: { ...input.baseConfig, maxHoldingMinutes: 240 },
      signalStrategy: base,
      symbols: input.symbols,
      notes: ["Extends max holding time to 240 minutes."]
    }),
    candidate({
      id: "J_wider_tp_sl_cost_buffer",
      label: "J. Wider TP/SL cost buffer",
      strategyId: input.baseStrategyId,
      strategy: {
        ...input.baseConfig,
        atrStopMultiplier: Math.max(input.baseConfig.atrStopMultiplier, 2.8),
        takeProfitRiskMultiple: Math.max(input.baseConfig.takeProfitRiskMultiple, 3.2),
        minTakeProfitPct: Math.max(input.baseConfig.minTakeProfitPct, 0.9),
        minExpectedValuePct: Math.max(input.baseConfig.minExpectedValuePct, 0.15)
      },
      signalStrategy: base,
      symbols: input.symbols,
      notes: ["Tests whether the current small target is being eaten by fee/slippage/spread."]
    })
  ];
}
