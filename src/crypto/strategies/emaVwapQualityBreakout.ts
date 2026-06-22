import type { CryptoStrategy } from "../strategyTypes";
import { buildLongTradePlan, clampScore, defaultTrendForAnalysis, trendGapPct } from "../tradeMath";

const DEFAULT_ORDER_USDT = 10;

export const emaVwapQualityBreakoutStrategy: CryptoStrategy = {
  id: "ema-vwap-quality-breakout",
  label: "EMA/VWAP quality breakout",
  generateSignal: ({ analysis, orderQuoteQty = DEFAULT_ORDER_USDT, config }) => {
    const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
    const tradePlan = buildLongTradePlan({ analysis, trend, score: 84, orderQuoteQty, config });
    const higherGapPct = trendGapPct(trend);
    const minVwapPct = Math.max(config.minPriceVwapPct, 0.4);
    const maxVwapPct = Math.min(config.maxPriceVwapPct, 0.9);
    const minSlopePct = Math.max(config.minEmaFastSlopePct, 0.08);
    const hardReasons: string[] = [];
    const reasons: string[] = [];
    let score = 55;

    if (trend.trend === "bullish") {
      score += 12;
      reasons.push("5m EMA trend is bullish");
    } else {
      hardReasons.push("5m EMA trend is not bullish");
    }

    if (trend.higherTrend === "bullish" && higherGapPct >= config.minHigherTrendGapPct) {
      score += 10;
      reasons.push("15m trend confirms with enough EMA gap");
    } else {
      hardReasons.push(`15m EMA gap ${higherGapPct.toFixed(3)}% is below the trend floor`);
    }

    if (analysis.volumeProfile.currentPricePosition === "above_value") {
      score += 8;
      reasons.push("Price has broken above the value area");
    } else {
      hardReasons.push("Price is not above the value area");
    }

    if (analysis.priceVsVwapPct >= minVwapPct && analysis.priceVsVwapPct <= maxVwapPct) {
      score += 8;
      reasons.push("VWAP distance is strong but not overextended");
    } else {
      hardReasons.push(`VWAP distance ${analysis.priceVsVwapPct.toFixed(2)}% is outside ${minVwapPct.toFixed(2)}%-${maxVwapPct.toFixed(2)}%`);
    }

    if (trend.emaFastSlopePct >= minSlopePct) {
      score += 7;
      reasons.push("5m EMA slope is strong enough");
    } else {
      hardReasons.push(`5m EMA slope ${trend.emaFastSlopePct.toFixed(3)}% is below ${minSlopePct.toFixed(3)}%`);
    }

    if (trend.rsi >= 52 && trend.rsi <= 67) {
      score += 7;
      reasons.push("RSI confirms momentum without the late-breakout zone");
    } else {
      hardReasons.push(`RSI ${trend.rsi.toFixed(1)} is outside the 52-67 quality breakout band`);
    }

    if (tradePlan.takeProfitPct < config.minTakeProfitPct) {
      hardReasons.push(`Gross take-profit ${tradePlan.takeProfitPct.toFixed(2)}% does not clear the ${config.minTakeProfitPct}% minimum`);
    }

    if (tradePlan.expectedValuePct < config.minExpectedValuePct) {
      hardReasons.push(`Expected value ${tradePlan.expectedValuePct.toFixed(3)}% is below the ${config.minExpectedValuePct}% minimum after estimated costs`);
    }

    if (analysis.liquidity.nearestAskDistancePct > config.maxSpreadPct) {
      hardReasons.push(`Nearest ask distance ${analysis.liquidity.nearestAskDistancePct.toFixed(3)}% is above the ${config.maxSpreadPct}% spread cap`);
    }

    return {
      symbol: analysis.symbol,
      action: hardReasons.length === 0 && score >= config.minBuyScore ? "buy" : "hold",
      score: clampScore(score),
      entryPrice: tradePlan.entryPrice,
      stopLoss: tradePlan.stopLoss,
      takeProfit: tradePlan.takeProfit,
      orderQuoteQty: tradePlan.orderQuoteQty,
      reasons: hardReasons.length > 0 ? [...reasons, ...hardReasons] : reasons
    };

  }
};
