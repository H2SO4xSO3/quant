import type { CryptoMarketAnalysis, CryptoSignal, CryptoStrategyConfig, CryptoTrendMetrics } from "../types";
import type { CryptoStrategy } from "../strategyTypes";
import { clampScore, defaultTrendForAnalysis, roundTripCostPct } from "../tradeMath";

const DEFAULT_ORDER_USDT = 10;
const MIN_CANDLE_BODY_PCT = 0.18;
const MIN_VOLUME_RATIO = 1.05;
const MIN_RETEST_DISTANCE_PCT = 0.1;
const MAX_RETEST_DISTANCE_PCT = 2;
const LONG_MIN_RSI = 52;
const LONG_MAX_RSI = 75;
const SHORT_MIN_RSI = 25;
const SHORT_MAX_RSI = 48;
const COST_MULTIPLE = 3;
const MAX_50X_STOP_DISTANCE_PCT = 1.2;
const MAX_50X_HOLDING_MINUTES = 60;

type Direction = "long" | "short";

function emaOrderConfirms(direction: Direction, trend: CryptoTrendMetrics): boolean {
  return direction === "long"
    ? trend.emaFast > trend.emaSlow && trend.emaSlow > trend.emaTrend
    : trend.emaFast < trend.emaSlow && trend.emaSlow < trend.emaTrend;
}

function retestHardReason(direction: Direction, analysis: CryptoMarketAnalysis): string | undefined {
  const structure = analysis.technical?.hourlyStructure;
  if (!structure || structure.bias === "neutral" || !structure.brokenLevel) {
    return undefined;
  }

  if (direction === "long" && analysis.price <= structure.brokenLevel) {
    return "Price is not holding above the broken 1h resistance after retest";
  }
  if (direction === "short" && analysis.price >= structure.brokenLevel) {
    return "Price is not holding below the broken 1h support after retest";
  }

  const distance = Math.abs(structure.distanceFromBrokenLevelPct);
  if (distance < MIN_RETEST_DISTANCE_PCT) {
    return `Price is only ${distance.toFixed(2)}% from the broken 1h level, not enough continuation after retest`;
  }
  if (distance > MAX_RETEST_DISTANCE_PCT) {
    return `Price is ${distance.toFixed(2)}% away, too far from the broken 1h level for a fresh retest entry`;
  }
  return undefined;
}

function chanHardReason(direction: Direction, analysis: CryptoMarketAnalysis): string | undefined {
  const chan = analysis.technical?.chan;
  if (!chan) {
    return "Chan structure is missing; skip 50x until direction is confirmed";
  }
  if (chan.setup === "center_chop" || chan.pricePosition === "inside_pivot") {
    return "Chan structure is inside pivot center chop";
  }
  if (direction === "long") {
    if (chan.trend !== "up") {
      return `Chan trend ${chan.trend} does not confirm long continuation`;
    }
    if (chan.pricePosition === "below_pivot") {
      return "Chan price is below pivot, not a right-side long";
    }
    if (chan.divergence === "bearish") {
      return "Chan bearish divergence blocks long continuation";
    }
    return undefined;
  }

  if (chan.trend !== "down") {
    return `Chan trend ${chan.trend} does not confirm short continuation`;
  }
  if (chan.pricePosition === "above_pivot") {
    return "Chan price is above pivot, not a right-side short";
  }
  if (chan.divergence === "bullish") {
    return "Chan bullish divergence blocks short continuation";
  }
  return undefined;
}

function scoreReasons(direction: Direction, analysis: CryptoMarketAnalysis, trend: CryptoTrendMetrics): { score: number; reasons: string[]; hardReasons: string[] } {
  const reasons: string[] = [];
  const hardReasons: string[] = [];
  const structure = analysis.technical?.hourlyStructure;
  const candleBodyPct = analysis.technical?.candleBodyPct ?? 0;
  const closePosition = analysis.technical?.closePosition ?? 0.5;
  const volumeRatio = analysis.technical?.volumeRatio ?? 1;
  let score = 44;

  if (!structure || structure.bias === "neutral") {
    hardReasons.push("1h structure has no confirmed breakout/breakdown bias");
  } else if (direction === "long" && structure.bias === "long" && structure.brokenLevelKind === "resistance") {
    score += 20;
    reasons.push("Video 1h bias is long after resistance breakout");
  } else if (direction === "short" && structure.bias === "short" && structure.brokenLevelKind === "support") {
    score += 20;
    reasons.push("Video 1h bias is short after support breakdown");
  } else {
    hardReasons.push(`1h structure bias ${structure.bias} does not match ${direction}`);
  }

  const retestReason = retestHardReason(direction, analysis);
  if (retestReason) {
    hardReasons.push(retestReason);
  } else if (structure?.bias === direction) {
    score += 6;
    reasons.push("Broken 1h level retest is close enough for fresh continuation");
  }

  const chanReason = chanHardReason(direction, analysis);
  if (chanReason) {
    hardReasons.push(chanReason);
  } else {
    score += 6;
    reasons.push(direction === "long" ? "Chan structure confirms right-side long continuation" : "Chan structure confirms right-side short continuation");
  }

  if (emaOrderConfirms(direction, trend)) {
    score += 18;
    reasons.push(direction === "long" ? "5m EMA order confirms long trend: EMA21 > EMA50 > EMA200" : "5m EMA order confirms short trend: EMA21 < EMA50 < EMA200");
  } else {
    hardReasons.push(direction === "long" ? "5m EMA order is not EMA21 > EMA50 > EMA200" : "5m EMA order is not EMA21 < EMA50 < EMA200");
  }

  if (direction === "long") {
    if (analysis.price > trend.emaFast && analysis.price > trend.emaSlow) {
      score += 8;
      reasons.push("Price is pushed above EMA21 and EMA50");
    } else {
      hardReasons.push("Price has not pushed above EMA21/EMA50");
    }
    if (trend.emaFastSlopePct > 0) {
      score += 5;
      reasons.push("EMA21 slope supports long momentum");
    } else {
      hardReasons.push("EMA21 slope is not positive for long entry");
    }
    if (trend.rsi >= LONG_MIN_RSI && trend.rsi <= LONG_MAX_RSI) {
      score += 8;
      reasons.push("RSI confirms long momentum");
    } else {
      hardReasons.push(`RSI ${trend.rsi.toFixed(1)} is outside the ${LONG_MIN_RSI}-${LONG_MAX_RSI} long momentum band`);
    }
    if (closePosition >= 0.65) {
      score += 5;
      reasons.push("Entry candle closes near its high");
    } else {
      hardReasons.push("Entry candle close is not strong enough for long momentum");
    }
  } else {
    if (analysis.price < trend.emaFast && analysis.price < trend.emaSlow) {
      score += 8;
      reasons.push("Price is pushed below EMA21 and EMA50");
    } else {
      hardReasons.push("Price has not pushed below EMA21/EMA50");
    }
    if (trend.emaFastSlopePct < 0) {
      score += 5;
      reasons.push("EMA21 slope supports short momentum");
    } else {
      hardReasons.push("EMA21 slope is not negative for short entry");
    }
    if (trend.rsi >= SHORT_MIN_RSI && trend.rsi <= SHORT_MAX_RSI) {
      score += 8;
      reasons.push("RSI confirms short momentum");
    } else {
      hardReasons.push(`RSI ${trend.rsi.toFixed(1)} is outside the ${SHORT_MIN_RSI}-${SHORT_MAX_RSI} short momentum band`);
    }
    if (closePosition <= 0.35) {
      score += 5;
      reasons.push("Entry candle closes near its low");
    } else {
      hardReasons.push("Entry candle close is not strong enough for short momentum");
    }
  }

  if (candleBodyPct >= MIN_CANDLE_BODY_PCT) {
    score += 7;
    reasons.push("Entry candle body pushes away from EMA21/EMA50");
  } else {
    hardReasons.push("Entry candle body is not strong enough to push away from EMA21/EMA50");
  }

  if (volumeRatio >= MIN_VOLUME_RATIO) {
    score += 3;
    reasons.push("Entry candle volume is above recent average");
  } else {
    hardReasons.push(`Volume ratio ${volumeRatio.toFixed(2)} is below the ${MIN_VOLUME_RATIO.toFixed(2)} momentum floor`);
  }

  return { score: clampScore(score), reasons, hardReasons };
}

function stopLossFor(direction: Direction, analysis: CryptoMarketAnalysis, trend: CryptoTrendMetrics): number {
  const structureLevel = analysis.technical?.hourlyStructure?.brokenLevel;
  const atrBuffer = Math.max(trend.atr * 0.15, analysis.price * 0.0005);
  if (direction === "long") {
    const levels = [trend.emaFast, trend.emaSlow, structureLevel].filter((value): value is number => typeof value === "number" && value > 0 && value < analysis.price);
    const base = levels.length > 0 ? Math.max(...levels) : analysis.price - trend.atr * 1.5;
    return Math.min(analysis.price * 0.999, base - atrBuffer);
  }
  const levels = [trend.emaFast, trend.emaSlow, structureLevel].filter((value): value is number => typeof value === "number" && value > 0 && value > analysis.price);
  const base = levels.length > 0 ? Math.min(...levels) : analysis.price + trend.atr * 1.5;
  return Math.max(analysis.price * 1.001, base + atrBuffer);
}

function buildSignal(direction: Direction, analysis: CryptoMarketAnalysis, orderQuoteQty: number, config: CryptoStrategyConfig): CryptoSignal {
  const trend = analysis.trend ?? defaultTrendForAnalysis(analysis);
  const scored = scoreReasons(direction, analysis, trend);
  const entryPrice = analysis.price;
  const stopLoss = stopLossFor(direction, analysis, trend);
  const risk = Math.abs(entryPrice - stopLoss);
  const stopDistancePct = entryPrice > 0 ? (risk / entryPrice) * 100 : 0;
  const takeProfit = direction === "long" ? entryPrice + risk * config.takeProfitRiskMultiple : entryPrice - risk * config.takeProfitRiskMultiple;
  const takeProfitPct = entryPrice > 0 ? (Math.abs(takeProfit - entryPrice) / entryPrice) * 100 : 0;
  const minCostAdjustedTakeProfitPct = roundTripCostPct(config) * COST_MULTIPLE;
  const hardReasons = [...scored.hardReasons];

  if (takeProfitPct < config.minTakeProfitPct) {
    hardReasons.push(`Gross take-profit ${takeProfitPct.toFixed(2)}% does not clear the ${config.minTakeProfitPct}% minimum`);
  }
  if (stopDistancePct > MAX_50X_STOP_DISTANCE_PCT) {
    hardReasons.push(`50x stop distance ${stopDistancePct.toFixed(2)}% is wider than the ${MAX_50X_STOP_DISTANCE_PCT.toFixed(2)}% liquidation buffer`);
  }
  if (takeProfitPct < minCostAdjustedTakeProfitPct) {
    hardReasons.push(`Gross take-profit ${takeProfitPct.toFixed(2)}% does not clear 3x estimated round-trip cost ${minCostAdjustedTakeProfitPct.toFixed(2)}%`);
  }

  return {
    symbol: analysis.symbol,
    action: hardReasons.length === 0 && scored.score >= config.minBuyScore ? (direction === "long" ? "buy" : "sell") : "hold",
    score: scored.score,
    entryPrice,
    stopLoss,
    takeProfit,
    orderQuoteQty,
    maxHoldingMinutes: Math.min(config.maxHoldingMinutes, MAX_50X_HOLDING_MINUTES),
    reasons: hardReasons.length > 0 ? [...scored.reasons, ...hardReasons] : scored.reasons
  };
}

export const videoEmaStructure50xStrategy: CryptoStrategy = {
  id: "video-ema-structure-50x",
  label: "Video 1h structure + 5m EMA/RSI 50x",
  generateSignal: ({ analysis, orderQuoteQty = DEFAULT_ORDER_USDT, config }) => {
    const bias = analysis.technical?.hourlyStructure?.bias;
    if (bias === "long") {
      return buildSignal("long", analysis, orderQuoteQty, config);
    }
    if (bias === "short") {
      return buildSignal("short", analysis, orderQuoteQty, config);
    }
    return buildSignal("long", analysis, orderQuoteQty, config);
  }
};
