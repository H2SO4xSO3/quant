import type { CryptoSignal } from "../types";
import type { CryptoStrategy } from "../strategyTypes";
import { clampScore, defaultTrendForAnalysis } from "../tradeMath";

const DEFAULT_ORDER_USDT = 10;
const STOP_LOSS_PCT = 14;
const TAKE_PROFIT_MULTIPLE = 10;
const EXIT_SCORE = 5;

export const TREND_BASKET_PERIOD_BY_SYMBOL: Record<string, number> = {
  ZECUSDT: 576,
  WLDUSDT: 576,
  TONUSDT: 576,
  FETUSDT: 864,
  NEARUSDT: 720,
  XLMUSDT: 360,
  ONDOUSDT: 720,
  TAOUSDT: 216,
  ENAUSDT: 576,
  SUIUSDT: 720,
  TRXUSDT: 720,
  BNBUSDT: 432,
  BTCUSDT: 432,
  ETHUSDT: 864
};

export const TREND_BASKET_SYMBOLS = Object.keys(TREND_BASKET_PERIOD_BY_SYMBOL);

export const factorLabelTrendBasketStrategy: CryptoStrategy = {
  id: "factor-label-trend-basket",
  label: "Factor-label high-liquidity trend basket",
  generateSignal: ({ analysis, orderQuoteQty = DEFAULT_ORDER_USDT, config }) => {
    const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
    const period = TREND_BASKET_PERIOD_BY_SYMBOL[analysis.symbol];
    const reasons: string[] = [];
    const hardReasons: string[] = [];

    if (!period) {
      return hold("Symbol is outside the researched trend basket");
    }

    const channel = analysis.technical?.donchianCloseByPeriod?.[period];
    const volumeRatio = analysis.technical?.volumeRatio ?? 1;
    if (!channel) {
      return hold(`${period}-bar Donchian close channel is missing`);
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
        maxHoldingMinutes: 0,
        reasons: [
          `Price is below the ${period}-bar lower close channel (${channel.breakdownPct.toFixed(2)}% from lower close)`,
          `trend basket ${analysis.symbol}: period=${period}, breakout=${channel.breakoutPct.toFixed(2)}%, range=${channel.rangePct.toFixed(2)}%`
        ]
      };
    }

    let score = 44;
    score += 18;
    reasons.push(`${analysis.symbol} matched the 90d high-liquidity trend basket`);

    if (analysis.price > channel.upperClose && channel.breakoutPct >= 0) {
      score += 30;
      reasons.push(`Price cleared the ${period}-bar upper close channel`);
    } else {
      score = Math.max(score, 35);
      hardReasons.push(`Price is still inside the ${period}-bar channel (${channel.breakoutPct.toFixed(2)}% from upper close)`);
    }

    if (trend.trend === "bullish" || trend.higherTrend === "bullish") {
      score += 4;
      reasons.push("Trend context supports the basket breakout");
    }

    if (volumeRatio >= 0.8) {
      score += 3;
      reasons.push("Volume is sufficient for the basket breakout");
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
        `trend basket ${analysis.symbol}: period=${period}, breakout=${channel.breakoutPct.toFixed(2)}%, breakdown=${channel.breakdownPct.toFixed(2)}%, range=${channel.rangePct.toFixed(2)}%`,
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
        maxHoldingMinutes: 0,
        reasons: [reason]
      };
    }
  }
};
