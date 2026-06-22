import type { CryptoSignal } from "../types";
import type { CryptoStrategy } from "../strategyTypes";
import { roundTripCostPct } from "../tradeMath";

const DEFAULT_ORDER_USDT = 10;

export const bollingerBreakevenStrategy: CryptoStrategy = {
  id: "bollinger-breakeven",
  label: "Bollinger edge breakeven reversion",
  generateSignal: ({ analysis, orderQuoteQty = DEFAULT_ORDER_USDT, config }) => {
    const bands = analysis.technical?.bollinger;
    const trend = analysis.trend;
    const reasons: string[] = [];

    if (!bands || !trend) {
      return hold("Bollinger or trend features are missing");
    }

    let score = 50;
    const edgeTouch = bands.percentB <= 0.16 || analysis.price <= bands.lower * 1.002;
    const lowerBandDistancePct = analysis.price > 0 ? ((analysis.price - bands.lower) / analysis.price) * 100 : 0;
    const middleReversionPct = analysis.price > 0 ? ((bands.middle - analysis.price) / analysis.price) * 100 : 0;
    const stopLoss = Math.min(analysis.price * 0.999, bands.lower - trend.atr * 0.35);
    const stopLossPct = analysis.price > 0 ? ((analysis.price - stopLoss) / analysis.price) * 100 : 0;
    const rawTakeProfit = Math.max(bands.middle, analysis.price * (1 + Math.max(config.minTakeProfitPct, 0.32) / 100));
    const takeProfit = rawTakeProfit > analysis.price ? rawTakeProfit : analysis.price * 1.0032;
    const takeProfitPct = analysis.price > 0 ? ((takeProfit - analysis.price) / analysis.price) * 100 : 0;
    const riskSizedOrderQuoteQty =
      stopLossPct > 0 && config.maxPositionLossUsdt
        ? Math.min(orderQuoteQty, config.maxPositionLossUsdt / (stopLossPct / 100))
        : orderQuoteQty;
    const estimatedRoundTripCostPct = roundTripCostPct(config);
    const probabilityWin = 0.52;
    const expectedValuePct = probabilityWin * takeProfitPct - (1 - probabilityWin) * stopLossPct - estimatedRoundTripCostPct;
    const hardReasons: string[] = [];

    if (edgeTouch) {
      score += 24;
      reasons.push("Price is touching the lower Bollinger edge");
    } else {
      hardReasons.push(`Bollinger percentB ${bands.percentB.toFixed(3)} is not close enough to the lower edge`);
    }

    if (trend.rsi >= 24 && trend.rsi <= 52) {
      score += 10;
      reasons.push("RSI is in a mean-reversion entry zone");
    } else {
      hardReasons.push(`RSI ${trend.rsi.toFixed(1)} is outside the 24-52 reversion band`);
    }

    if (trend.trend !== "bearish" || trend.higherTrend !== "bearish") {
      score += 6;
      reasons.push("Trend is not bearish on both local and higher windows");
    } else {
      hardReasons.push("Both local and higher trends are bearish");
    }

    if (bands.bandwidthPct >= 0.18 && bands.bandwidthPct <= 3.2) {
      score += 7;
      reasons.push("Bollinger bandwidth is tradable");
    } else {
      hardReasons.push(`Bollinger bandwidth ${bands.bandwidthPct.toFixed(2)}% is outside the tradable range`);
    }

    if (middleReversionPct >= config.minTakeProfitPct) {
      score += 8;
      reasons.push("Middle-band reversion has enough gross room");
    } else {
      hardReasons.push(`Middle-band room ${middleReversionPct.toFixed(2)}% is below the ${config.minTakeProfitPct}% gross target floor`);
    }

    if (trend.atrPct <= 1.3) {
      score += 4;
      reasons.push("ATR is not in a liquidation-style volatility spike");
    } else {
      hardReasons.push(`ATR ${trend.atrPct.toFixed(2)}% is too high for spot mean reversion`);
    }

    if (analysis.liquidity.nearestAskDistancePct > config.maxSpreadPct) {
      hardReasons.push(`Nearest ask distance ${analysis.liquidity.nearestAskDistancePct.toFixed(3)}% is above the ${config.maxSpreadPct}% spread cap`);
    }

    if (takeProfitPct < config.minTakeProfitPct) {
      hardReasons.push(`Gross take-profit ${takeProfitPct.toFixed(2)}% does not clear the ${config.minTakeProfitPct}% minimum`);
    }

    if (expectedValuePct < config.minExpectedValuePct) {
      hardReasons.push(`Expected value ${expectedValuePct.toFixed(3)}% is below the ${config.minExpectedValuePct}% minimum after estimated costs`);
    }

    return {
      symbol: analysis.symbol,
      action: hardReasons.length === 0 && score >= config.minBuyScore ? "buy" : "hold",
      score: Math.max(0, Math.min(100, score)),
      entryPrice: analysis.price,
      stopLoss,
      takeProfit,
      orderQuoteQty: Number(riskSizedOrderQuoteQty.toFixed(8)),
      reasons: [
        ...reasons,
        `Bollinger lower distance=${lowerBandDistancePct.toFixed(2)}%, percentB=${bands.percentB.toFixed(3)}`,
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
