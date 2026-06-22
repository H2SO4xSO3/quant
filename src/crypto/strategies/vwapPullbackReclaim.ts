import type { CryptoMarketAnalysis, CryptoSignal } from "../types";
import type { CryptoStrategy } from "../strategyTypes";
import { buildLongTradePlan, clampScore, defaultTrendForAnalysis, type TradePlan } from "../tradeMath";

const DEFAULT_ORDER_USDT = 10;
const MIN_RECLAIM_VWAP_PCT = 0.05;
const MAX_RECLAIM_VWAP_PCT = 0.85;
const MAX_POC_EXTENSION_PCT = 0.8;

function pctFrom(base: number, value: number): number {
  return base > 0 ? ((value - base) / base) * 100 : 0;
}

function scoreReclaimSetup(analysis: CryptoMarketAnalysis): { score: number; reasons: string[] } {
  const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
  const reasons: string[] = [];
  let score = 46;

  const priceVsPocPct = pctFrom(analysis.volumeProfile.pointOfControl.price, analysis.price);

  if (analysis.volumeProfile.currentPricePosition === "inside_value") {
    score += 14;
    reasons.push("Price is inside the value area instead of chasing extension");
  }

  if (
    analysis.price > analysis.vwap &&
    analysis.price >= analysis.volumeProfile.pointOfControl.price &&
    analysis.priceVsVwapPct >= MIN_RECLAIM_VWAP_PCT &&
    analysis.priceVsVwapPct <= MAX_RECLAIM_VWAP_PCT &&
    priceVsPocPct >= 0 &&
    priceVsPocPct <= MAX_POC_EXTENSION_PCT
  ) {
    score += 16;
    reasons.push("VWAP pullback reclaim: price recovered VWAP and POC without over-extension");
  }

  if (trend.trend === "bullish") {
    score += 8;
    reasons.push("5m trend is turning up for the reclaim");
  } else if (trend.trend === "neutral") {
    score += 4;
    reasons.push("5m trend is neutral enough for a reclaim entry");
  }

  if (trend.higherTrend === "bullish") {
    score += 10;
    reasons.push("15m trend supports the reclaim");
  } else if (trend.higherTrend === "neutral") {
    score += 6;
    reasons.push("15m trend is neutral, not fighting the reclaim");
  }

  if (trend.emaFastSlopePct >= 0.01) {
    score += 5;
    reasons.push("5m EMA slope has turned positive");
  }

  if (trend.rsi >= 46 && trend.rsi <= 66) {
    score += 8;
    reasons.push("RSI is in the reclaim band");
  }

  if (analysis.liquidity.bidAskImbalance > 0.12) {
    score += 8;
    reasons.push("Order book confirms bid support");
  }

  if (analysis.footprint.buySellImbalance > 0.12) {
    score += 7;
    reasons.push("Footprint shows fresh taker-buy flow");
  }

  if (analysis.deepTrades.largeTradeBuyRatio >= 0.58) {
    score += 5;
    reasons.push("Large trades lean buy-side during the reclaim");
  }

  if (trend.atrPct >= 0.12 && trend.atrPct <= 1.2) {
    score += 4;
    reasons.push("ATR is tradable for a paper spot entry");
  }

  return { score: clampScore(score), reasons };
}

function hardEntryReasons(
  analysis: CryptoMarketAnalysis,
  tradePlan: TradePlan,
  config: { maxSpreadPct: number; minTakeProfitPct: number; minExpectedValuePct: number }
): string[] {
  const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
  const reasons: string[] = [];
  const poc = analysis.volumeProfile.pointOfControl.price;
  const priceVsPocPct = pctFrom(poc, analysis.price);

  if (analysis.volumeProfile.currentPricePosition !== "inside_value") {
    reasons.push(`Price is ${analysis.volumeProfile.currentPricePosition}; VWAP reclaim entries must stay inside value area`);
  }
  if (analysis.volumeProfile.currentPricePosition === "above_value") {
    reasons.push("Price is above value area; avoid chasing a completed move");
  }
  if (analysis.price <= analysis.vwap || analysis.price < poc) {
    reasons.push("Exit invalidation: reclaim lost VWAP/POC support");
    reasons.push("Price has not reclaimed both VWAP and POC");
  }
  if (analysis.priceVsVwapPct < MIN_RECLAIM_VWAP_PCT) {
    reasons.push(`Price is only ${analysis.priceVsVwapPct.toFixed(2)}% above VWAP, below the reclaim confirmation floor`);
  }
  if (analysis.priceVsVwapPct > MAX_RECLAIM_VWAP_PCT || priceVsPocPct > MAX_POC_EXTENSION_PCT) {
    reasons.push(`Price is too extended for a VWAP reclaim entry: VWAP gap=${analysis.priceVsVwapPct.toFixed(2)}%, POC gap=${priceVsPocPct.toFixed(2)}%`);
  }
  if (trend.trend === "bearish") {
    reasons.push("5m trend is bearish; pullback has not stabilized");
  }
  if (trend.higherTrend === "bearish") {
    reasons.push("15m trend is bearish; reclaim is fighting the higher timeframe");
  }
  if (trend.emaFastSlopePct < 0.01) {
    reasons.push(`5m EMA slope ${trend.emaFastSlopePct.toFixed(3)}% has not turned up`);
  }
  if (trend.rsi < 46 || trend.rsi > 66) {
    reasons.push(`RSI ${trend.rsi.toFixed(1)} is outside the 46-66 reclaim band`);
  }
  if (trend.atrPct < 0.12 || trend.atrPct > 1.2) {
    reasons.push(`ATR ${trend.atrPct.toFixed(2)}% is outside the reclaim strategy range`);
  }
  if (analysis.liquidity.bidAskImbalance <= 0.12) {
    reasons.push("Order book does not confirm bid support for the reclaim");
  }
  if (analysis.footprint.buySellImbalance <= 0.12) {
    reasons.push("Footprint does not show enough taker-buy reclaim flow");
  }
  if (analysis.deepTrades.largeTradeBuyRatio < 0.58) {
    reasons.push("Large trades do not lean buy-side during the reclaim");
  }
  if (analysis.liquidity.nearestAskDistancePct > config.maxSpreadPct) {
    reasons.push(`Nearest ask distance ${analysis.liquidity.nearestAskDistancePct.toFixed(3)}% is above the ${config.maxSpreadPct}% spread cap`);
  }
  if (tradePlan.takeProfit <= tradePlan.entryPrice) {
    reasons.push("Take-profit is not above entry");
  }

  if (tradePlan.takeProfitPct < config.minTakeProfitPct) {
    reasons.push(`Gross take-profit ${tradePlan.takeProfitPct.toFixed(2)}% does not clear the ${config.minTakeProfitPct}% minimum`);
  }
  if (tradePlan.expectedValuePct < config.minExpectedValuePct) {
    reasons.push(`Expected value ${tradePlan.expectedValuePct.toFixed(3)}% is below the ${config.minExpectedValuePct}% minimum after estimated costs`);
  }

  return reasons;
}

export const vwapPullbackReclaimStrategy: CryptoStrategy = {
  id: "vwap-pullback-reclaim",
  label: "VWAP/value-area pullback reclaim",
  generateSignal: ({ analysis, orderQuoteQty = DEFAULT_ORDER_USDT, config }) => {
    const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
    const { score, reasons } = scoreReclaimSetup(analysis);
    const tradePlan = buildLongTradePlan({ analysis, trend, score, orderQuoteQty, config });
    const baseSignal: CryptoSignal = {
      symbol: analysis.symbol,
      action: "hold",
      score,
      entryPrice: tradePlan.entryPrice,
      stopLoss: tradePlan.stopLoss,
      takeProfit: tradePlan.takeProfit,
      orderQuoteQty: tradePlan.orderQuoteQty,
      maxHoldingMinutes: Math.max(config.maxHoldingMinutes, 90),
      reasons
    };
    const hardReasons = hardEntryReasons(analysis, tradePlan, config);

    return {
      ...baseSignal,
      action: hardReasons.length === 0 && score >= config.minBuyScore ? "buy" : "hold",
      reasons: hardReasons.length > 0 ? [...reasons, ...hardReasons] : reasons
    };
  }
};
