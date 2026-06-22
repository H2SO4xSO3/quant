import type { CryptoSignal } from "../types";
import type { CryptoStrategy } from "../strategyTypes";
import { clampScore, defaultTrendForAnalysis } from "../tradeMath";

const DEFAULT_ORDER_USDT = 10;
const TARGET_SYMBOLS = new Set(["BNBUSDT", "BTCUSDT"]);
const STOP_LOSS_PCT = 14;
const TAKE_PROFIT_MULTIPLE = 10;
const EXIT_SCORE = 5;

export const factorLabelBnbBreakoutStrategy: CryptoStrategy = {
  id: "factor-label-bnb-breakout",
  label: "Factor-label BNB/BTC long close-channel breakout",
  generateSignal: ({ analysis, orderQuoteQty = DEFAULT_ORDER_USDT, config }) => {
    const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
    const channel = analysis.technical?.donchianClose;
    const volumeRatio = analysis.technical?.volumeRatio ?? 1;
    const reasons: string[] = [];
    const hardReasons: string[] = [];

    if (!channel) {
      return hold("432-bar Donchian close channel is missing");
    }

    if (analysis.price <= channel.lowerClose || channel.breakdownPct < 0) {
      return {
        symbol: analysis.symbol,
        action: "hold",
        score: EXIT_SCORE,
        entryPrice: analysis.price,
        stopLoss: analysis.price,
        takeProfit: analysis.price,
        orderQuoteQty: 0,
        reasons: [
          `Price is below the 432-bar lower close channel (${channel.breakdownPct.toFixed(2)}% from lower close)`,
          `BNB/BTC long close-channel breakout: breakout=${channel.breakoutPct.toFixed(2)}%, range=${channel.rangePct.toFixed(2)}%`
        ]
      };
    }

    let score = 44;
    if (TARGET_SYMBOLS.has(analysis.symbol)) {
      score += analysis.symbol === "BNBUSDT" ? 22 : 14;
      reasons.push("BNB/BTC matched the 90d positive long breakout bucket");
    } else {
      hardReasons.push("Long close-channel breakout edge is currently limited to BNBUSDT/BTCUSDT");
    }

    if (analysis.price > channel.upperClose && channel.breakoutPct >= 0) {
      score += 30;
      reasons.push("Price cleared the 432-bar upper close channel");
    } else {
      score = Math.max(score, 35);
      hardReasons.push(`Price is still inside the channel (${channel.breakoutPct.toFixed(2)}% from upper close)`);
    }

    if (trend.trend === "bullish" || trend.higherTrend === "bullish") {
      score += 4;
      reasons.push("Trend context is not fighting the breakout");
    }

    if (volumeRatio >= 0.8) {
      score += 3;
      reasons.push("Volume is sufficient for the long breakout branch");
    }

    if (analysis.liquidity.nearestAskDistancePct > config.maxSpreadPct) {
      hardReasons.push(`Nearest ask distance ${analysis.liquidity.nearestAskDistancePct.toFixed(3)}% is above the ${config.maxSpreadPct}% spread cap`);
    }

    const stopLoss = analysis.price * (1 - STOP_LOSS_PCT / 100);
    const takeProfit = analysis.price * TAKE_PROFIT_MULTIPLE;
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
      maxHoldingMinutes: 0,
      reasons: [
        ...reasons,
        `BNB/BTC long close-channel breakout: breakout=${channel.breakoutPct.toFixed(2)}%, breakdown=${channel.breakdownPct.toFixed(2)}%, range=${channel.rangePct.toFixed(2)}%`,
        ...hardReasons
      ]
    };

    function hold(reason: string): CryptoSignal {
      return {
        symbol: analysis.symbol,
        action: "hold",
        score: 0,
        entryPrice: analysis.price,
        stopLoss: analysis.price,
        takeProfit: analysis.price,
        orderQuoteQty: 0,
        reasons: [reason]
      };
    }
  }
};
