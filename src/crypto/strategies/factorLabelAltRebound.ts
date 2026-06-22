import type { CryptoSignal } from "../types";
import type { CryptoStrategy } from "../strategyTypes";
import { clampScore, defaultTrendForAnalysis } from "../tradeMath";

const DEFAULT_ORDER_USDT = 10;
const TARGET_SYMBOLS = new Set(["SOLUSDT", "XRPUSDT"]);
const TAKE_PROFIT_PCT = 1.6;
const STOP_LOSS_PCT = 1;
const MAX_HOLDING_MINUTES = 240;

export const factorLabelAltReboundStrategy: CryptoStrategy = {
  id: "factor-label-alt-rebound",
  label: "Factor-label SOL/XRP capitulation rebound",
  generateSignal: ({ analysis, orderQuoteQty = DEFAULT_ORDER_USDT, config }) => {
    const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
    const technical = analysis.technical;
    const reasons: string[] = [];
    const hardReasons: string[] = [];
    let score = 40;

    const recentReturn6Pct = technical?.recentReturn6Pct ?? 0;
    const volumeRatio = technical?.volumeRatio ?? 1;
    const lowerWickPct = technical?.lowerWickPct ?? 0;
    const closePosition = technical?.closePosition ?? 0.5;

    if (TARGET_SYMBOLS.has(analysis.symbol)) {
      score += 15;
      reasons.push("SOLUSDT/XRPUSDT matched the 90d positive rebound bucket");
    } else {
      hardReasons.push("Factor-label rebound edge is currently limited to SOLUSDT/XRPUSDT");
    }

    if (recentReturn6Pct <= -0.8) {
      score += 13;
      reasons.push("6-bar return shows a fast washout");
    } else {
      hardReasons.push(`6-bar return ${recentReturn6Pct.toFixed(2)}% is not washed out enough`);
    }

    if (trend.rsi <= 42) {
      score += 9;
      reasons.push("RSI is in the rebound-mined band");
    } else {
      hardReasons.push(`RSI ${trend.rsi.toFixed(1)} is above the rebound-mined band`);
    }

    if (volumeRatio >= 1.2) {
      score += 9;
      reasons.push("Volume expands during the washout");
    } else {
      hardReasons.push(`Volume ratio ${volumeRatio.toFixed(2)} is below the mined threshold`);
    }

    if (lowerWickPct >= 0.14) {
      score += 7;
      reasons.push("Lower wick shows buyers absorbing the flush");
    } else {
      hardReasons.push(`Lower wick ${lowerWickPct.toFixed(2)}% is below the mined threshold`);
    }

    if (closePosition >= 0.65) {
      score += 8;
      reasons.push("Candle closes in the upper part of its range");
    } else {
      hardReasons.push(`Close position ${closePosition.toFixed(2)} is below the mined reclaim threshold`);
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
      maxHoldingMinutes: MAX_HOLDING_MINUTES,
      reasons: [
        ...reasons,
        `factor-label alt rebound: return6=${recentReturn6Pct.toFixed(2)}%, volumeRatio=${volumeRatio.toFixed(2)}, lowerWick=${lowerWickPct.toFixed(2)}%, closePosition=${closePosition.toFixed(2)}`,
        ...hardReasons
      ]
    };
  }
};
