import type { CryptoSignal } from "../types";
import type { CryptoStrategy } from "../strategyTypes";
import { clampScore, defaultTrendForAnalysis } from "../tradeMath";

const DEFAULT_ORDER_USDT = 10;
const TARGET_SYMBOL = "ETHUSDT";
const TAKE_PROFIT_PCT = 0.85;
const STOP_LOSS_PCT = 0.55;

export const factorLabelCapitulationReclaimStrategy: CryptoStrategy = {
  id: "factor-label-capitulation-reclaim",
  label: "Factor-label ETH capitulation reclaim",
  generateSignal: ({ analysis, orderQuoteQty = DEFAULT_ORDER_USDT, config }) => {
    const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
    const technical = analysis.technical;
    const reasons: string[] = [];
    const hardReasons: string[] = [];

    let score = 42;
    const recentReturn6Pct = technical?.recentReturn6Pct ?? 0;
    const volumeRatio = technical?.volumeRatio ?? 1;
    const lowerWickPct = technical?.lowerWickPct ?? 0;
    const closePosition = technical?.closePosition ?? 0.5;

    if (analysis.symbol === TARGET_SYMBOL) {
      score += 14;
      reasons.push("ETHUSDT matched the 14d positive factor-label bucket");
    } else {
      hardReasons.push(`Factor-label edge is currently limited to ${TARGET_SYMBOL}`);
    }

    if (recentReturn6Pct <= -0.55) {
      score += 13;
      reasons.push("6-bar return shows capitulation pressure");
    } else {
      hardReasons.push(`6-bar return ${recentReturn6Pct.toFixed(2)}% is not washed out enough`);
    }

    if (trend.rsi <= 36) {
      score += 11;
      reasons.push("RSI is in the capitulation band");
    } else {
      hardReasons.push(`RSI ${trend.rsi.toFixed(1)} is above the capitulation band`);
    }

    if (volumeRatio >= 1.15) {
      score += 9;
      reasons.push("Relative volume confirms the selloff");
    } else {
      hardReasons.push(`Volume ratio ${volumeRatio.toFixed(2)} is below capitulation confirmation`);
    }

    if (lowerWickPct >= 0.12 && closePosition >= 0.55) {
      score += 12;
      reasons.push("Candle reclaimed away from the low after the flush");
    } else {
      hardReasons.push(`Lower wick ${lowerWickPct.toFixed(2)}% / close position ${closePosition.toFixed(2)} did not reclaim enough`);
    }

    if (trend.atrPct >= 0.18 && trend.atrPct <= 1.4) {
      score += 7;
      reasons.push("ATR is large enough for a rebound but not liquidation-spike sized");
    } else {
      hardReasons.push(`ATR ${trend.atrPct.toFixed(2)}% is outside the labelled rebound range`);
    }

    if (analysis.liquidity.nearestAskDistancePct > config.maxSpreadPct) {
      hardReasons.push(`Nearest ask distance ${analysis.liquidity.nearestAskDistancePct.toFixed(3)}% is above the ${config.maxSpreadPct}% spread cap`);
    }

    const stopLoss = analysis.price * (1 - STOP_LOSS_PCT / 100);
    const takeProfit = analysis.price * (1 + TAKE_PROFIT_PCT / 100);
    const riskSizedOrderQuoteQty =
      config.maxPositionLossUsdt && STOP_LOSS_PCT > 0 ? Math.min(orderQuoteQty, config.maxPositionLossUsdt / (STOP_LOSS_PCT / 100)) : orderQuoteQty;

    return {
      symbol: analysis.symbol,
      action: hardReasons.length === 0 && score >= config.minBuyScore ? "buy" : "hold",
      score: clampScore(score),
      entryPrice: analysis.price,
      stopLoss,
      takeProfit,
      orderQuoteQty: Number(riskSizedOrderQuoteQty.toFixed(8)),
      reasons: [
        ...reasons,
        `factor-label capitulation reclaim: return6=${recentReturn6Pct.toFixed(2)}%, volumeRatio=${volumeRatio.toFixed(2)}, lowerWick=${lowerWickPct.toFixed(2)}%, closePosition=${closePosition.toFixed(2)}`,
        ...hardReasons
      ]
    };
  }
};
