import type { CryptoSignal } from "../types";
import type { CryptoStrategy } from "../strategyTypes";
import { clampScore, defaultTrendForAnalysis, roundTripCostPct, trendGapPct } from "../tradeMath";

const DEFAULT_ORDER_USDT = 10;

export const aberrationVolatilityBreakoutStrategy: CryptoStrategy = {
  id: "aberration-volatility-breakout",
  label: "Aberration-style volatility channel breakout",
  generateSignal: ({ analysis, orderQuoteQty = DEFAULT_ORDER_USDT, config }) => {
    const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
    const channel = analysis.technical?.volatilityChannel;
    const reasons: string[] = [];
    const hardReasons: string[] = [];

    if (!channel) {
      return hold("Volatility channel features are missing");
    }

    let score = 45;
    const higherGapPct = trendGapPct(trend);
    const atr = Math.max(trend.atr, analysis.price * 0.0015);
    const basisStop = channel.basis > 0 && channel.basis < analysis.price ? channel.basis : analysis.price - atr * config.atrStopMultiplier;
    const channelStop = channel.breakoutLine > 0 ? channel.breakoutLine - atr * 0.75 : analysis.price - atr * config.atrStopMultiplier;
    const atrStop = analysis.price - atr * config.atrStopMultiplier;
    const stopLoss = Math.min(analysis.price * 0.999, Math.max(atrStop, channelStop, basisStop));
    const stopLossPct = analysis.price > 0 ? ((analysis.price - stopLoss) / analysis.price) * 100 : 0;
    const takeProfit = analysis.price + Math.max(analysis.price - stopLoss, atr * 0.8) * config.takeProfitRiskMultiple;
    const takeProfitPct = analysis.price > 0 ? ((takeProfit - analysis.price) / analysis.price) * 100 : 0;
    const riskSizedOrderQuoteQty =
      stopLossPct > 0 && config.maxPositionLossUsdt
        ? Math.min(orderQuoteQty, config.maxPositionLossUsdt / (stopLossPct / 100))
        : orderQuoteQty;

    if (analysis.marketRegime) {
      if (analysis.marketRegime.isRiskOn) {
        score += 6;
        reasons.push(`${analysis.marketRegime.benchmarkSymbol} market regime is risk-on`);
      } else {
        hardReasons.push(`Market regime blocked the breakout: ${analysis.marketRegime.reasons[0]}`);
      }
    }

    if (analysis.price > channel.breakoutLine && channel.breakoutPct >= 0.05) {
      score += 24;
      reasons.push("Price cleared the volatility channel breakout line");
    } else {
      hardReasons.push(
        `Price has not cleared the volatility breakout line (${channel.breakoutPct.toFixed(2)}% from breakout)`
      );
    }

    if (trend.trend === "bullish" && analysis.price > trend.emaTrend) {
      score += 12;
      reasons.push("5m trend confirms the volatility channel breakout");
    } else {
      hardReasons.push("5m trend does not confirm the volatility channel breakout");
    }

    if (trend.higherTrend === "bullish" && higherGapPct >= Math.max(0, config.minHigherTrendGapPct * 0.7)) {
      score += 10;
      reasons.push("15m trend confirms the breakout regime");
    } else {
      hardReasons.push(`15m EMA gap ${higherGapPct.toFixed(3)}% is not strong enough for breakout mode`);
    }

    if (analysis.priceVsVwapPct >= Math.max(0.05, config.minPriceVwapPct * 0.5) && analysis.priceVsVwapPct <= Math.min(2.4, config.maxPriceVwapPct)) {
      score += 8;
      reasons.push("VWAP confirms upside pressure without extreme extension");
    } else {
      hardReasons.push(`VWAP distance ${analysis.priceVsVwapPct.toFixed(2)}% is outside breakout entry bounds`);
    }

    if (trend.rsi >= 52 && trend.rsi <= 78) {
      score += 8;
      reasons.push("RSI is in a momentum breakout band");
    } else {
      hardReasons.push(`RSI ${trend.rsi.toFixed(1)} is outside the 52-78 breakout band`);
    }

    if (channel.bandwidthPct >= 0.22 && channel.bandwidthPct <= 7.5 && trend.atrPct <= 1.5) {
      score += 7;
      reasons.push("Volatility is wide enough to trade but not in a spike regime");
    } else {
      hardReasons.push(`Channel bandwidth ${channel.bandwidthPct.toFixed(2)}% / ATR ${trend.atrPct.toFixed(2)}% is outside tradable bounds`);
    }

    if (trend.emaFastSlopePct >= Math.max(0.015, config.minEmaFastSlopePct * 0.5)) {
      score += 6;
      reasons.push("Fast EMA slope supports continuation");
    } else {
      hardReasons.push(`5m EMA slope ${trend.emaFastSlopePct.toFixed(3)}% is too weak for continuation`);
    }

    if (analysis.volumeProfile.currentPricePosition === "above_value") {
      score += 5;
      reasons.push("Price is above the recent value area");
    }

    if (analysis.footprint.buySellImbalance > 0.08) {
      score += 5;
      reasons.push("Taker flow leans buy-side");
    } else if (analysis.footprint.buySellImbalance < -0.1) {
      score -= 6;
      hardReasons.push("Taker flow leans sell-side");
    }

    if (analysis.deepTrades.largeTradeBuyRatio >= 0.58) {
      score += 4;
      reasons.push("Large trades support the breakout");
    } else if (analysis.deepTrades.largeTradeBuyRatio < 0.42) {
      score -= 5;
      hardReasons.push("Large trades do not support the breakout");
    }

    if (analysis.liquidity.bidAskImbalance > 0.08) {
      score += 3;
      reasons.push("Order book has modest bid support");
    }

    const estimatedRoundTripCostPct = roundTripCostPct(config);
    const probabilityWin = Math.max(0.05, Math.min(0.78, clampScore(score) / 100));
    const expectedValuePct = probabilityWin * takeProfitPct - (1 - probabilityWin) * stopLossPct - estimatedRoundTripCostPct;

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
      score: clampScore(score),
      entryPrice: analysis.price,
      stopLoss,
      takeProfit,
      orderQuoteQty: Number(riskSizedOrderQuoteQty.toFixed(8)),
      reasons: [
        ...reasons,
        `Aberration volatility channel breakout: breakout=${channel.breakoutPct.toFixed(2)}%, bandwidth=${channel.bandwidthPct.toFixed(2)}%`,
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
