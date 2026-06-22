import type { CryptoMarketAnalysis, CryptoSignal, CryptoStrategyConfig } from "../types";
import type { CryptoStrategy } from "../strategyTypes";
import { buildShortTradePlan, clampScore, defaultTrendForAnalysis, roundTripCostPct, type TradePlan } from "../tradeMath";

const DEFAULT_ORDER_USDT = 10;
const MIN_BREAKDOWN_VWAP_PCT = -0.12;
const MIN_POC_BREAKDOWN_PCT = -0.08;
const SHORT_TARGET_COST_MULTIPLE = 3;

function pctFrom(base: number, value: number): number {
  return base > 0 ? ((value - base) / base) * 100 : 0;
}

function scoreBreakdownSetup(analysis: CryptoMarketAnalysis): { score: number; reasons: string[] } {
  const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
  const reasons: string[] = [];
  let score = 44;
  const priceVsPocPct = pctFrom(analysis.volumeProfile.pointOfControl.price, analysis.price);

  if (analysis.price < analysis.vwap && priceVsPocPct <= MIN_POC_BREAKDOWN_PCT) {
    score += 18;
    reasons.push("VWAP breakdown short: price lost VWAP and POC");
  }
  if (analysis.volumeProfile.currentPricePosition === "below_value") {
    score += 12;
    reasons.push("Price is below the value area");
  } else if (analysis.volumeProfile.currentPricePosition === "inside_value" && analysis.price < analysis.volumeProfile.pointOfControl.price) {
    score += 6;
    reasons.push("Price is inside value but below POC");
  }
  if (trend.trend === "bearish") {
    score += 10;
    reasons.push("5m trend confirms downside pressure");
  } else if (trend.trend === "neutral") {
    score += 4;
    reasons.push("5m trend is neutral enough for a breakdown short");
  }
  if (trend.higherTrend !== "bullish") {
    score += 8;
    reasons.push("15m trend is not bullish");
  }
  if (trend.emaFastSlopePct <= -0.01) {
    score += 6;
    reasons.push("5m EMA slope is negative");
  }
  if (trend.rsi >= 32 && trend.rsi <= 58) {
    score += 7;
    reasons.push("RSI leaves room for downside continuation");
  }
  if (analysis.footprint.buySellImbalance < -0.12) {
    score += 8;
    reasons.push("Footprint shows taker-sell pressure");
  }
  if (analysis.deepTrades.largeTradeBuyRatio <= 0.42) {
    score += 6;
    reasons.push("Large trades lean sell-side");
  }
  if (analysis.liquidity.bidAskImbalance < -0.12) {
    score += 8;
    reasons.push("Order book shows ask pressure");
  }
  if (trend.atrPct >= 0.12 && trend.atrPct <= 1.5) {
    score += 4;
    reasons.push("ATR is tradable for a futures short");
  }

  return { score: clampScore(score), reasons };
}

function hardEntryReasons(
  analysis: CryptoMarketAnalysis,
  tradePlan: TradePlan,
  config: CryptoStrategyConfig
): string[] {
  const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
  const reasons: string[] = [];
  const priceVsPocPct = pctFrom(analysis.volumeProfile.pointOfControl.price, analysis.price);
  const symbol = analysis.symbol.toUpperCase();
  const minCostAdjustedTakeProfitPct = roundTripCostPct(config) * SHORT_TARGET_COST_MULTIPLE;

  if (symbol === "BNBUSDT") {
    reasons.push("BNBUSDT short is disabled after repeated paper drag");
  }
  if (symbol === "BTCUSDT" && analysis.volumeProfile.currentPricePosition !== "below_value") {
    reasons.push("BTC short requires price below value area after paper review");
  }

  if (analysis.priceVsVwapPct > MIN_BREAKDOWN_VWAP_PCT || analysis.price >= analysis.vwap) {
    reasons.push("Price has not lost VWAP enough for a fresh short");
  }
  if (priceVsPocPct > MIN_POC_BREAKDOWN_PCT) {
    reasons.push(`Price is only ${priceVsPocPct.toFixed(2)}% below POC, not a confirmed breakdown`);
  }
  if (analysis.volumeProfile.currentPricePosition === "above_value") {
    reasons.push("Price is above value area; short breakdown is invalid");
  }
  if (trend.higherTrend === "bullish") {
    reasons.push("15m trend is bullish; avoid shorting into higher-timeframe support");
  }
  if (trend.emaFastSlopePct > -0.01) {
    reasons.push(`5m EMA slope ${trend.emaFastSlopePct.toFixed(3)}% is not negative enough`);
  }
  if (trend.rsi < 32 || trend.rsi > 58) {
    reasons.push(`RSI ${trend.rsi.toFixed(1)} is outside the 32-58 short entry band`);
  }
  if (analysis.footprint.buySellImbalance >= -0.12) {
    reasons.push("Footprint does not show enough taker-sell pressure");
  }
  if (analysis.deepTrades.largeTradeBuyRatio > 0.42) {
    reasons.push("Large trades do not lean sell-side enough");
  }
  if (analysis.liquidity.bidAskImbalance >= -0.12) {
    reasons.push("Order book does not show ask pressure");
  }
  if (trend.atrPct < 0.12 || trend.atrPct > 1.5) {
    reasons.push(`ATR ${trend.atrPct.toFixed(2)}% is outside the futures short range`);
  }
  if (analysis.liquidity.nearestAskDistancePct > config.maxSpreadPct) {
    reasons.push(`Nearest ask distance ${analysis.liquidity.nearestAskDistancePct.toFixed(3)}% is above the ${config.maxSpreadPct}% spread cap`);
  }
  if (tradePlan.takeProfitPct < config.minTakeProfitPct) {
    reasons.push(`Gross take-profit ${tradePlan.takeProfitPct.toFixed(2)}% does not clear the ${config.minTakeProfitPct}% minimum`);
  }
  if (tradePlan.takeProfitPct < minCostAdjustedTakeProfitPct) {
    reasons.push(
      `Gross take-profit ${tradePlan.takeProfitPct.toFixed(2)}% does not clear 3x estimated round-trip cost ${minCostAdjustedTakeProfitPct.toFixed(2)}%`
    );
  }

  return reasons;
}

export const vwapBreakdownShortStrategy: CryptoStrategy = {
  id: "vwap-breakdown-short",
  label: "VWAP/value-area breakdown short",
  generateSignal: ({ analysis, orderQuoteQty = DEFAULT_ORDER_USDT, config }): CryptoSignal => {
    const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
    const { score, reasons } = scoreBreakdownSetup(analysis);
    const tradePlan = buildShortTradePlan({ analysis, trend, score, orderQuoteQty, config });
    const hardReasons = hardEntryReasons(analysis, tradePlan, config);

    return {
      symbol: analysis.symbol,
      action: hardReasons.length === 0 && score >= config.minBuyScore ? "sell" : "hold",
      score,
      entryPrice: tradePlan.entryPrice,
      stopLoss: tradePlan.stopLoss,
      takeProfit: tradePlan.takeProfit,
      orderQuoteQty: tradePlan.orderQuoteQty,
      maxHoldingMinutes: Math.max(config.maxHoldingMinutes, 60),
      reasons: hardReasons.length > 0 ? [...reasons, ...hardReasons] : reasons
    };
  }
};
