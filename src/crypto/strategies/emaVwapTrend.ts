import type { CryptoMarketAnalysis, CryptoSignal, CryptoStrategyConfig } from "../types";
import type { CryptoStrategy } from "../strategyTypes";
import { buildLongTradePlan, clampScore, defaultTrendForAnalysis, trendGapPct } from "../tradeMath";

const DEFAULT_ORDER_USDT = 10;

export const DEFAULT_STRATEGY_CONFIG: CryptoStrategyConfig = {
  minBuyScore: 94,
  emaFastPeriod: 9,
  emaSlowPeriod: 21,
  emaTrendPeriod: 50,
  higherEmaFastPeriod: 20,
  higherEmaSlowPeriod: 50,
  rsiPeriod: 14,
  atrPeriod: 14,
  atrStopMultiplier: 2.4,
  takeProfitRiskMultiple: 2.4,
  minPriceVwapPct: 0.15,
  maxPriceVwapPct: 3,
  minEmaFastSlopePct: 0.04,
  minHigherTrendGapPct: 0.05,
  minTakeProfitPct: 0.55,
  minExpectedValuePct: 0.08,
  estimatedSlippagePct: 0.03,
  priceImpactPct: 0.04,
  maxSpreadPct: 0.18,
  entryCooldownMinutes: 180,
  breakevenTriggerPct: 0.45,
  trailingStopTriggerPct: 0.75,
  trailingStopGivebackPct: 0.35,
  signalExitScore: 42,
  maxHoldingMinutes: 60,
  maxPositionLossUsdt: 3,
  feeRate: 0.001
};

export function scoreEmaVwapAnalysis(analysis: CryptoMarketAnalysis): { score: number; reasons: string[] } {
  let score = 50;
  const reasons: string[] = [];
  const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);

  if (trend.trend === "bullish") {
    score += 16;
    reasons.push("5m EMA trend is bullish");
  } else if (trend.trend === "bearish") {
    score -= 18;
    reasons.push("5m EMA trend is bearish");
  }

  if (analysis.price > trend.emaTrend) {
    score += 8;
    reasons.push("Price is above EMA trend filter");
  } else {
    score -= 8;
    reasons.push("Price is below EMA trend filter");
  }

  if (trend.higherTrend === "bullish") {
    score += 12;
    reasons.push("15m trend confirms the 5m signal");
  } else if (trend.higherTrend === "bearish") {
    score -= 14;
    reasons.push("15m trend conflicts with the 5m signal");
  }

  if (trend.rsi >= 50 && trend.rsi <= 70) {
    score += 9;
    reasons.push("RSI confirms momentum without being overbought");
  } else if (trend.rsi > 76) {
    score -= 7;
    reasons.push("RSI is overheated");
  } else if (trend.rsi < 45) {
    score -= 8;
    reasons.push("RSI momentum is weak");
  }

  if (analysis.priceVsVwapPct > 0.15) {
    score += Math.min(9, analysis.priceVsVwapPct * 3);
    reasons.push("Price is above VWAP");
  } else if (analysis.priceVsVwapPct < -0.15) {
    score -= Math.min(12, Math.abs(analysis.priceVsVwapPct) * 4);
    reasons.push("Price is below VWAP");
  }

  if (analysis.volumeProfile.currentPricePosition === "inside_value" && analysis.price >= analysis.volumeProfile.pointOfControl.price) {
    score += 7;
    reasons.push("Price is inside value area and above POC");
  } else if (analysis.volumeProfile.currentPricePosition === "above_value") {
    score += 2;
    reasons.push("Price is above value area");
  } else {
    score -= 6;
    reasons.push("Price is below value area");
  }

  if (analysis.footprint.buySellImbalance > 0.18) {
    score += 8;
    reasons.push("Footprint shows taker-buy imbalance");
  } else if (analysis.footprint.buySellImbalance < -0.18) {
    score -= 10;
    reasons.push("Footprint shows taker-sell imbalance");
  }

  if (analysis.deepTrades.largeTradeBuyRatio > 0.62) {
    score += 6;
    reasons.push("Large trades lean buy-side");
  } else if (analysis.deepTrades.largeTradeBuyRatio < 0.38) {
    score -= 8;
    reasons.push("Large trades lean sell-side");
  }

  if (analysis.liquidity.bidAskImbalance > 0.12) {
    score += 5;
    reasons.push("Order book has stronger bid support");
  } else if (analysis.liquidity.bidAskImbalance < -0.12) {
    score -= 6;
    reasons.push("Order book has heavier ask pressure");
  }

  if (trend.atrPct > 1.2) {
    score -= 8;
    reasons.push("ATR volatility is too high for the current position size");
  } else if (trend.atrPct >= 0.12) {
    score += 3;
    reasons.push("ATR volatility is tradable");
  }

  return { score: clampScore(score), reasons };
}

function bullishFlowConfirmationCount(analysis: CryptoMarketAnalysis): number {
  return [
    analysis.footprint.buySellImbalance > 0.18,
    analysis.deepTrades.largeTradeBuyRatio > 0.62,
    analysis.liquidity.bidAskImbalance > 0.12
  ].filter(Boolean).length;
}

export function decideSignal(
  analysis: CryptoMarketAnalysis,
  orderQuoteQty = DEFAULT_ORDER_USDT,
  config: CryptoStrategyConfig = DEFAULT_STRATEGY_CONFIG
): CryptoSignal {
  const { score, reasons } = scoreEmaVwapAnalysis(analysis);
  const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
  const tradePlan = buildLongTradePlan({ analysis, trend, score, orderQuoteQty, config });
  const hardReasons: string[] = [];
  const higherTrendGapPct = trendGapPct(trend);

  if (trend.trend !== "bullish") {
    hardReasons.push("5m EMA trend is not bullish");
  }
  if (trend.higherTrend !== "bullish") {
    hardReasons.push("15m EMA trend is not bullish");
  }
  if (analysis.price <= analysis.vwap) {
    hardReasons.push("Price is not above VWAP");
  }
  if (analysis.priceVsVwapPct < config.minPriceVwapPct) {
    hardReasons.push(`Price is only ${analysis.priceVsVwapPct.toFixed(2)}% above VWAP, below the ${config.minPriceVwapPct}% minimum`);
  }
  if (analysis.priceVsVwapPct > config.maxPriceVwapPct) {
    hardReasons.push(`Price is ${analysis.priceVsVwapPct.toFixed(2)}% above VWAP, too extended for a fresh entry`);
  }
  if (trend.emaFastSlopePct < config.minEmaFastSlopePct) {
    hardReasons.push(`5m EMA slope ${trend.emaFastSlopePct.toFixed(3)}% is below the ${config.minEmaFastSlopePct}% momentum floor`);
  }
  if (higherTrendGapPct < config.minHigherTrendGapPct) {
    hardReasons.push(`15m EMA gap ${higherTrendGapPct.toFixed(3)}% is below the ${config.minHigherTrendGapPct}% trend floor`);
  }
  if (trend.rsi < 50 || trend.rsi > 72) {
    hardReasons.push(`RSI ${trend.rsi.toFixed(1)} is outside the 50-72 entry band`);
  }
  if (trend.atrPct > 1.2) {
    hardReasons.push(`ATR ${trend.atrPct.toFixed(2)}% is too high for this spot bot`);
  }
  if (tradePlan.takeProfitPct < config.minTakeProfitPct) {
    hardReasons.push(`Gross take-profit ${tradePlan.takeProfitPct.toFixed(2)}% does not clear the ${config.minTakeProfitPct}% minimum after fees`);
  }
  if (tradePlan.expectedValuePct < config.minExpectedValuePct) {
    hardReasons.push(`Expected value ${tradePlan.expectedValuePct.toFixed(3)}% is below the ${config.minExpectedValuePct}% minimum after estimated costs`);
  }
  if (analysis.liquidity.nearestAskDistancePct > config.maxSpreadPct) {
    hardReasons.push(`Nearest ask distance ${analysis.liquidity.nearestAskDistancePct.toFixed(3)}% is above the ${config.maxSpreadPct}% spread cap`);
  }
  if (analysis.volumeProfile.currentPricePosition === "above_value") {
    hardReasons.push("Price is above value area; avoid chasing extension in EMA/VWAP trend mode");
  }
  if (analysis.volumeProfile.currentPricePosition === "below_value") {
    hardReasons.push("Price is below value area; wait for a value-area reclaim before EMA/VWAP trend entry");
  }
  if (analysis.liquidity.bidAskImbalance < -0.12) {
    hardReasons.push("Order book has heavier ask pressure; avoid long entry");
  }
  if (analysis.liquidity.bidAskImbalance <= 0.12) {
    hardReasons.push("Order book does not show stronger bid support; avoid long entry");
  }
  if (bullishFlowConfirmationCount(analysis) < 2) {
    hardReasons.push("Entry lacks at least two bullish flow confirmations from footprint, large trades, and order book support");
  }

  return {
    symbol: analysis.symbol,
    action: hardReasons.length === 0 && score >= config.minBuyScore ? "buy" : "hold",
    score,
    entryPrice: tradePlan.entryPrice,
    stopLoss: tradePlan.stopLoss,
    takeProfit: tradePlan.takeProfit,
    orderQuoteQty: tradePlan.orderQuoteQty,
    reasons: hardReasons.length > 0 ? [...reasons, ...hardReasons] : reasons
  };
}

export const emaVwapTrendStrategy: CryptoStrategy = {
  id: "ema-vwap-trend",
  label: "EMA/VWAP trend follower",
  generateSignal: ({ analysis, orderQuoteQty, config }) => decideSignal(analysis, orderQuoteQty, config)
};
